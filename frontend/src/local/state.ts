/**
 * 本地数据仓库：全部业务实体驻留手机（IndexedDB），内存中持有可变状态，
 * 每次变更立即落盘并写入操作历史（可撤销）。替代原服务端 InventoryRepository。
 */
import { docGet, docPut, blobGet, blobPut, blobDelete, blobAll } from './storage'

export { blobAll }

export interface MemberRow { id: number; name: string; sort_order: number }
export interface GroupRow { id: number; owner_id: number; name: string; sort_order: number }
export interface ContainerRow {
  id: number; name: string; notes: string; owner_id: number; group_id: number | null;
  pos_x: number | null; pos_y: number | null; pos_z: number | null;
  size_w: number | null; size_h: number | null; size_d: number | null;
  sort_order?: number;
  last_opened_at?: string | null;
  created_at: string; updated_at: string
}
export interface ItemRow {
  id: number; container_id: number; owner_id: number; name: string;
  quantity: number | null; quantity_text: string; condition: string; notes: string; tags: string;
  created_at: string; updated_at: string
}
export interface RecipeRow { id: number; title: string; steps: string; created_at: string; updated_at: string }
export interface AttachmentRow {
  id: number; item_id: number | null; container_id: number | null; recipe_id: number | null;
  kind: 'image' | 'file' | 'video'; filename: string; mime_type: string; size_bytes: number; created_at: string
}
export interface HistoryRow {
  id: number; action_type: 'add' | 'update' | 'delete'; entity_type: 'item' | 'container' | 'group' | 'recipe' | 'attachment';
  entity_id: number; container_id: number | null; item_id: number | null; owner_id: number;
  source: 'manual' | 'ai' | 'system'; description: string; created_at: string;
  undone_at: string | null; before: unknown
}
export interface AiLocal { base_url: string; model: string; api_key: string }
/** 电脑开关配置（MAC/IP/控制令牌）。只存本机，不随云同步上传（含令牌）。 */
export interface PcHostRow {
  id: number; name: string; mac: string; ip: string; port: number; token: string
}
/** 健康记录：体重与便便。at 为本地时间 'YYYY-MM-DD HH:mm'。 */
export interface HealthRow {
  id: number
  type: 'weight' | 'bowel'
  at: string
  kg: number | null
  bristol: number | null
  note: string
}

export interface LocalState {
  version: 1
  seq: number
  members: MemberRow[]
  groups: GroupRow[]
  containers: ContainerRow[]
  items: ItemRow[]
  recipes: RecipeRow[]
  attachments: AttachmentRow[]
  history: HistoryRow[]
  ai: AiLocal
  pcs?: PcHostRow[]
  health?: HealthRow[]
}

export function freshState(): LocalState {
  return {
    version: 1, seq: 1000,
    members: [{ id: 1, name: '家', sort_order: 1 }],
    groups: [], containers: [], items: [], recipes: [], attachments: [], history: [],
    ai: { base_url: 'http://192.168.3.100:31415/v1', model: 'auto', api_key: '' },
    pcs: [],
    health: [],
  }
}

export const state: LocalState = freshState()
export const loaded = { done: false }
/** 附件 id → 本地对象 URL（启动时预生成，<img> 同步可用） */
export const blobUrls = new Map<number, string>()

/** 启动初始化：读取本地状态与附件对象 URL。 */
export async function initLocal(): Promise<void> {
  if (loaded.done) return
  await loadState()
  loaded.done = true
}

export function nextId(): number {
  state.seq += 1
  return state.seq
}

export function now(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19)
}

export async function loadState(): Promise<void> {
  const saved = await docGet<LocalState>('state')
  if (saved) Object.assign(state, saved)
  for (const att of await blobAll()) {
    if (!blobUrls.has(att.id)) blobUrls.set(att.id, URL.createObjectURL(att.bytes))
  }
  loaded.done = true
}

let saveTimer: ReturnType<typeof setTimeout> | null = null
export function persist(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    docPut('state', state).catch(() => undefined)
  }, 150)
}

export async function persistNow(): Promise<void> {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null }
  try { await docPut('state', state) } catch { /* 环境不支持 IndexedDB 时仅内存生效 */ }
}

export async function replaceState(incoming: LocalState): Promise<void> {
  // 清掉旧附件的对象 URL 与存储，再整体换入
  for (const url of blobUrls.values()) URL.revokeObjectURL(url)
  blobUrls.clear()
  for (const att of incoming.attachments) {
    const stored = await blobGet(att.id)
    if (stored) blobUrls.set(att.id, URL.createObjectURL(stored.bytes))
  }
  Object.assign(state, incoming)
  await persistNow()
}

export function logHistory(entry: Omit<HistoryRow, 'id' | 'created_at' | 'undone_at' | 'container_id' | 'item_id'> & { container_id?: number | null; item_id?: number | null }): void {
  state.history.unshift({
    ...entry,
    container_id: entry.container_id ?? null,
    item_id: entry.item_id ?? null,
    id: nextId(), created_at: now(), undone_at: null,
  })
  if (state.history.length > 2000) state.history.length = 2000
}

// ---- 计算视图（对齐原服务端 SQL 的派生字段）----

function itemsOf(containerId: number): ItemRow[] {
  return state.items.filter((i) => i.container_id === containerId)
}

function coverOf(kind: 'container' | 'item' | 'recipe', id: number): number | null {
  const rows = state.attachments.filter((a) =>
    (kind === 'container' ? a.container_id : kind === 'item' ? a.item_id : a.recipe_id) === id && a.kind === 'image')
  return rows.length ? Math.max(...rows.map((a) => a.id)) : null
}

export function containerView(c: ContainerRow) {
  const items = itemsOf(c.id)
  const group = state.groups.find((g) => g.id === c.group_id)
  return {
    ...c,
    owner_name: state.members.find((m) => m.id === c.owner_id)?.name ?? '',
    group_name: group?.name ?? null,
    item_count: items.length,
    quantity_sum: items.reduce((s, i) => s + (i.quantity ?? 0), 0),
    attachment_count: state.attachments.filter((a) => a.container_id === c.id).length,
    cover_attachment_id: coverOf('container', c.id),
    item_names: items.map((i) => i.name).join('、') || null,
  }
}

export function itemView(i: ItemRow) {
  const container = state.containers.find((c) => c.id === i.container_id)
  return {
    ...i,
    container_name: container?.name ?? '',
    owner_name: state.members.find((m) => m.id === i.owner_id)?.name ?? '',
    attachment_count: state.attachments.filter((a) => a.item_id === i.id).length,
    cover_attachment_id: coverOf('item', i.id),
  }
}

export function recipeView(r: RecipeRow) {
  return { ...r, attachment_count: state.attachments.filter((a) => a.recipe_id === r.id).length, cover_attachment_id: coverOf('recipe', r.id) }
}

export function summary() {
  const quantity = state.items.reduce((s, i) => s + (i.quantity ?? 0), 0)
  const special = state.items.filter((i) => i.condition && i.condition !== '正常').length
  return { containers: state.containers.length, items: state.items.length, quantity, special }
}

export function memberSummary() {
  return state.members.map((m) => {
    const containers = state.containers.filter((c) => c.owner_id === m.id)
    const ids = new Set(containers.map((c) => c.id))
    const items = state.items.filter((i) => ids.has(i.container_id))
    return {
      id: m.id, name: m.name, containers: containers.length, items: items.length,
      quantity: items.reduce((s, i) => s + (i.quantity ?? 0), 0),
    }
  })
}

/** 存储附件文件（图片/其它），返回新附件行。 */
export async function storeAttachment(
  file: File, link: { item_id?: number; container_id?: number; recipe_id?: number }, source: 'manual' | 'ai',
): Promise<AttachmentRow> {
  const id = nextId()
  const mime = file.type || 'application/octet-stream'
  const kind: AttachmentRow['kind'] = mime.startsWith('image/') ? 'image' : mime.startsWith('video/') ? 'video' : 'file'
  const row: AttachmentRow = {
    id, item_id: link.item_id ?? null, container_id: link.container_id ?? null, recipe_id: link.recipe_id ?? null,
    kind, filename: file.name || `file-${id}`, mime_type: mime, size_bytes: file.size, created_at: now(),
  }
  // 封面只留一张：同实体已有图片时，新图替换旧图（附件字节与元数据一并删除）
  if (kind === 'image') {
    const olds = state.attachments.filter((a) =>
      (link.item_id != null ? a.item_id === link.item_id : link.container_id != null ? a.container_id === link.container_id : link.recipe_id != null && a.recipe_id === link.recipe_id)
      && a.kind === 'image')
    for (const old of olds) {
      state.attachments = state.attachments.filter((a) => a.id !== old.id)
      await blobDelete(old.id)
      const oldUrl = blobUrls.get(old.id)
      if (oldUrl) { URL.revokeObjectURL(oldUrl); blobUrls.delete(old.id) }
    }
  }
  state.attachments.unshift(row)
  await blobPut(id, { mime, bytes: file })
  blobUrls.set(id, URL.createObjectURL(file))
  logHistory({
    action_type: 'add', entity_type: 'attachment', entity_id: id,
    container_id: link.container_id ?? null, item_id: link.item_id ?? null, owner_id: 1,
    source, description: `上传附件 ${row.filename}`, before: null,
  })
  persist()
  return row
}

export async function removeAttachment(id: number): Promise<void> {
  const row = state.attachments.find((a) => a.id === id)
  if (!row) return
  state.attachments = state.attachments.filter((a) => a.id !== id)
  await blobDelete(id)
  const url = blobUrls.get(id)
  if (url) { URL.revokeObjectURL(url); blobUrls.delete(id) }
  logHistory({
    action_type: 'delete', entity_type: 'attachment', entity_id: id,
    container_id: row.container_id, item_id: row.item_id, owner_id: 1,
    source: 'manual', description: `删除附件 ${row.filename}`, before: row,
  })
  persist()
}

export function requireContainer(id: number): ContainerRow {
  const c = state.containers.find((x) => x.id === id)
  if (!c) throw new Error('箱子不存在')
  return c
}

export function requireItem(id: number): ItemRow {
  const i = state.items.find((x) => x.id === id)
  if (!i) throw new Error('物品不存在')
  return i
}
