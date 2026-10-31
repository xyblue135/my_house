/**
 * 本地 API：在单机模式下接管前端全部 /api/* 调用，返回结构与原服务端一致，
 * 视图代码零改动。持久化在 IndexedDB（src/local/state.ts），同步走 useGitSync。
 */
import type { Attachment, Container, ContainerGroup, Dashboard, HistoryEntry, Item, Member, Recipe } from '../types'
import {
  state, nextId, now, persist, logHistory, containerView, itemView, recipeView,
  summary, memberSummary, storeAttachment, removeAttachment, requireContainer, requireItem,
  type GroupRow,
} from './state'
import { aiChat, aiExecute } from './ai'

export interface LocalRequest {
  method: string
  path: string
  query: URLSearchParams
  body: unknown
  form: FormData | null
}

function num(value: unknown, fallback = 0): number {
  // null/undefined/空串必须回退到默认值（Number(null) === 0 的陷阱）
  if (value == null || value === '') return fallback
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function str(value: unknown, fallback = ''): string {
  return value == null ? fallback : String(value)
}

function requireGroup(id: number): GroupRow {
  const g = state.groups.find((x) => x.id === id)
  if (!g) throw new Error('分组不存在')
  return g
}

function sortRows<T extends { sort_order?: number; id: number }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.id - b.id)
}

function historyView(h: (typeof state.history)[number]): HistoryEntry {
  return {
    id: h.id, action_type: h.action_type, entity_type: h.entity_type, entity_id: h.entity_id,
    item_id: h.item_id, container_id: h.container_id, related_container_id: null, owner_id: h.owner_id,
    source: h.source, description: h.description, created_at: h.created_at, undone_at: h.undone_at,
    can_undo: h.action_type !== 'update' || true,
  }
}

function itemAttachments(itemId: number): Attachment[] {
  return state.attachments.filter((a) => a.item_id === itemId) as unknown as Attachment[]
}

function containerAttachments(containerId: number): Attachment[] {
  return state.attachments.filter((a) => a.container_id === containerId) as unknown as Attachment[]
}

function recipeAttachments(recipeId: number): Attachment[] {
  return state.attachments.filter((a) => a.recipe_id === recipeId) as unknown as Attachment[]
}

function itemByNamePayload(body: Record<string, unknown>) {
  return {
    container_id: num(body.container_id),
    name: str(body.name).trim(),
    quantity: body.quantity == null || body.quantity === '' ? null : num(body.quantity),
    quantity_text: str(body.quantity_text),
    condition: str(body.condition, '正常'),
    notes: str(body.notes),
    tags: str(body.tags),
  }
}

/** 撤销一条历史：add → 删除，update → 还原，delete → 重建。 */
function undoEntry(entry: (typeof state.history)[number]): void {
  if (entry.undone_at) throw new Error('该记录已撤销过')
  const entity = entry.before as Record<string, unknown> | null
  switch (`${entry.action_type}:${entry.entity_type}`) {
    case 'add:item':
    case 'add:container':
    case 'add:group':
    case 'add:recipe': {
      if (entry.entity_type === 'item') state.items = state.items.filter((i) => i.id !== entry.entity_id)
      if (entry.entity_type === 'container') state.containers = state.containers.filter((c) => c.id !== entry.entity_id)
      if (entry.entity_type === 'group') state.groups = state.groups.filter((g) => g.id !== entry.entity_id)
      if (entry.entity_type === 'recipe') state.recipes = state.recipes.filter((r) => r.id !== entry.entity_id)
      break
    }
    case 'update:item':
    case 'update:container':
    case 'update:group':
    case 'update:recipe': {
      if (!entity) throw new Error('没有可还原的历史数据')
      if (entry.entity_type === 'item') {
        const idx = state.items.findIndex((i) => i.id === entry.entity_id)
        if (idx >= 0) state.items[idx] = entity as unknown as (typeof state.items)[number]
      }
      if (entry.entity_type === 'container') {
        const idx = state.containers.findIndex((c) => c.id === entry.entity_id)
        if (idx >= 0) state.containers[idx] = entity as unknown as (typeof state.containers)[number]
      }
      if (entry.entity_type === 'group') {
        const idx = state.groups.findIndex((g) => g.id === entry.entity_id)
        if (idx >= 0) state.groups[idx] = entity as unknown as (typeof state.groups)[number]
      }
      if (entry.entity_type === 'recipe') {
        const idx = state.recipes.findIndex((r) => r.id === entry.entity_id)
        if (idx >= 0) state.recipes[idx] = entity as unknown as (typeof state.recipes)[number]
      }
      break
    }
    case 'delete:item':
    case 'delete:container':
    case 'delete:group':
    case 'delete:recipe': {
      if (!entity) throw new Error('没有可还原的历史数据')
      if (entry.entity_type === 'item') state.items.unshift(entity as unknown as (typeof state.items)[number])
      if (entry.entity_type === 'container') state.containers.unshift(entity as unknown as (typeof state.containers)[number])
      if (entry.entity_type === 'group') state.groups.unshift(entity as unknown as (typeof state.groups)[number])
      if (entry.entity_type === 'recipe') state.recipes.unshift(entity as unknown as (typeof state.recipes)[number])
      break
    }
    case 'add:attachment':
      void removeAttachment(entry.entity_id)
      break
    case 'delete:attachment': {
      if (!entity) break
      const row = entity as unknown as (typeof state.attachments)[number]
      state.attachments.unshift(row)
      // 字节流无法凭记录恢复：撤销删除附件仅还原元数据（与原服务端行为一致）
      break
    }
    default:
      throw new Error('该记录不支持撤销')
  }
  entry.undone_at = now()
  persist()
}

export async function localApi(req: LocalRequest): Promise<unknown> {
  const { method, path, query, body } = req
  const b = (body ?? {}) as Record<string, unknown>
  const [pathOnly, pathQs] = path.split('?')
  if (pathQs) for (const [k, v] of new URLSearchParams(pathQs)) if (!query.has(k)) query.set(k, v)
  const seg = pathOnly.split('/').filter(Boolean) // ['api', 'items', '12', 'attachments'] ...
  const kind = seg[1]
  const id = seg[2] ? Number(seg[2]) : NaN
  const sub = seg[3]

  // ---- members / dashboard ----
  if (path === '/api/members') {
    return state.members as unknown as Member[]
  }
  if (path === '/api/dashboard') {
    const dash: Dashboard = {
      summary: summary(),
      members: memberSummary(),
      recent_history: state.history.slice(0, 20).map(historyView),
    }
    return dash
  }

  // ---- containers ----
  if (path === '/api/containers' && method === 'GET') {
    return sortRows(state.containers).map(containerView) as unknown as Container[]
  }
  if (path === '/api/containers/reorder' && method === 'POST') {
    const ids = (Array.isArray(b.ids) ? b.ids : []).map(Number)
    ids.forEach((cid, index) => {
      const c = state.containers.find((x) => x.id === cid)
      if (c) { c.sort_order = index + 1; c.updated_at = now() }
    })
    logHistory({
      action_type: 'update', entity_type: 'container', entity_id: 0, container_id: null, item_id: null,
      owner_id: num(b.owner_id, 1), source: 'manual', description: `调整箱子排序（${ids.length} 个）`, before: null,
    })
    persist()
    return { ok: true }
  }
  if (path === '/api/containers' && method === 'POST') {
    const name = str(b.name).trim()
    if (!name) throw new Error('箱子名称不能为空')
    if (b.group_id != null) requireGroup(num(b.group_id))
    const row = {
      id: nextId(), name, notes: str(b.notes), owner_id: num(b.owner_id, 1),
      group_id: b.group_id == null ? null : num(b.group_id),
      pos_x: null, pos_y: null, pos_z: null, size_w: null, size_h: null, size_d: null,
      sort_order: state.containers.length + 1, created_at: now(), updated_at: now(),
    }
    state.containers.unshift(row)
    logHistory({
      action_type: 'add', entity_type: 'container', entity_id: row.id, container_id: row.id,
      owner_id: row.owner_id, source: 'manual', description: `新建箱子「${name}」`, before: null,
    })
    persist()
    return containerView(row)
  }
  if (kind === 'containers' && seg[2] && !seg[3]) {
    const container = requireContainer(id)
    if (method === 'GET') return containerView(container)
    if (method === 'PATCH') {
      const before = { ...container }
      if (b.name != null) {
        const name = str(b.name).trim()
        if (!name) throw new Error('箱子名称不能为空')
        container.name = name
      }
      if (b.notes != null) container.notes = str(b.notes)
      if (b.group_id !== undefined) {
        if (b.group_id != null) requireGroup(num(b.group_id))
        container.group_id = b.group_id == null ? null : num(b.group_id)
      }
      for (const key of ['pos_x', 'pos_y', 'pos_z', 'size_w', 'size_h', 'size_d'] as const) {
        if (b[key] !== undefined) (container[key] as number | null) = b[key] == null ? null : num(b[key])
      }
      container.updated_at = now()
      logHistory({
        action_type: 'update', entity_type: 'container', entity_id: container.id, container_id: container.id,
        owner_id: container.owner_id, source: 'manual', description: `修改箱子「${container.name}」`, before,
      })
      persist()
      return containerView(container)
    }
    if (method === 'POST' && seg[3] === 'opened') {
      container.last_opened_at = now()
      persist()
      return { ok: true }
    }
    if (method === 'DELETE') {
      if (itemsOfLength(container.id) > 0) throw new Error('该箱子里还有物品，请先移动或删除物品')
      for (const att of [...containerAttachments(container.id)]) await removeAttachment(att.id)
      state.containers = state.containers.filter((c) => c.id !== container.id)
      logHistory({
        action_type: 'delete', entity_type: 'container', entity_id: container.id, container_id: container.id,
        owner_id: container.owner_id, source: 'manual', description: `删除箱子「${container.name}」`, before: { ...container },
      })
      persist()
      return { ok: true }
    }
  }

  // ---- groups ----
  if (path === '/api/groups' && method === 'GET') return sortRows(state.groups) as unknown as ContainerGroup[]
  if (path === '/api/groups' && method === 'POST') {
    const name = str(b.name).trim()
    if (!name) throw new Error('分组名称不能为空')
    const row = { id: nextId(), owner_id: num(b.owner_id, 1), name, sort_order: state.groups.length + 1 }
    state.groups.push(row)
    logHistory({
      action_type: 'add', entity_type: 'group', entity_id: row.id, owner_id: row.owner_id,
      source: 'manual', description: `新建分组「${name}」`, before: null,
    })
    persist()
    return row
  }
  if (kind === 'groups' && seg[2] && method === 'DELETE') {
    const group = requireGroup(id)
    state.groups = state.groups.filter((g) => g.id !== group.id)
    for (const c of state.containers) if (c.group_id === group.id) c.group_id = null
    logHistory({
      action_type: 'delete', entity_type: 'group', entity_id: group.id, owner_id: group.owner_id,
      source: 'manual', description: `删除分组「${group.name}」`, before: { ...group },
    })
    persist()
    return { ok: true }
  }

  // ---- items ----
  if (path === '/api/items' && method === 'GET') {
    const q = (query.get('q') || '').trim().toLocaleLowerCase()
    const containerId = query.get('container_id') ? Number(query.get('container_id')) : null
    let rows = state.items.map(itemView)
    if (containerId != null) rows = rows.filter((i) => i.container_id === containerId)
    if (q) {
      rows = rows.filter((i) => {
        const c = state.containers.find((x) => x.id === i.container_id)
        return (i.name + ' ' + i.notes + ' ' + i.tags + ' ' + (c?.name ?? '')).toLocaleLowerCase().includes(q)
      })
    }
    return rows.slice(0, 500) as unknown as Item[]
  }
  if (path === '/api/items' && method === 'POST') {
    const payload = itemByNamePayload(b)
    if (!payload.name) throw new Error('物品名称不能为空')
    const container = requireContainer(payload.container_id)
    const row = {
      id: nextId(), container_id: container.id, owner_id: container.owner_id, name: payload.name,
      quantity: payload.quantity, quantity_text: payload.quantity_text, condition: payload.condition,
      notes: payload.notes, tags: payload.tags, created_at: now(), updated_at: now(),
    }
    state.items.unshift(row)
    logHistory({
      action_type: 'add', entity_type: 'item', entity_id: row.id, item_id: row.id, container_id: container.id,
      owner_id: row.owner_id, source: 'manual', description: `添加物品「${row.name}」到「${container.name}」`, before: null,
    })
    persist()
    return itemView(row)
  }
  if (kind === 'items' && seg[2] && !seg[3]) {
    const item = requireItem(id)
    if (method === 'GET') return itemView(item)
    if (method === 'PATCH') {
      const before = { ...item }
      const payload = itemByNamePayload({ ...item, ...b })
      if (!payload.name) throw new Error('物品名称不能为空')
      const container = requireContainer(payload.container_id)
      Object.assign(item, payload, { owner_id: container.owner_id, updated_at: now() })
      logHistory({
        action_type: 'update', entity_type: 'item', entity_id: item.id, item_id: item.id,
        container_id: item.container_id, owner_id: item.owner_id, source: 'manual',
        description: `修改物品「${item.name}」`, before,
      })
      persist()
      return itemView(item)
    }
    if (method === 'DELETE') {
      const container = requireContainer(item.container_id)
      for (const att of [...itemAttachments(item.id)]) await removeAttachment(att.id)
      state.items = state.items.filter((i) => i.id !== item.id)
      logHistory({
        action_type: 'delete', entity_type: 'item', entity_id: item.id, item_id: item.id,
        container_id: container.id, owner_id: item.owner_id, source: 'manual',
        description: `删除物品「${item.name}」`, before: { ...item },
      })
      persist()
      return { ok: true }
    }
  }

  // ---- attachments ----
  if (kind === 'items' && seg[3] === 'attachments' && method === 'POST') {
    const file = req.form?.get('file')
    if (!(file instanceof File)) throw new Error('缺少附件文件')
    return await storeAttachment(file, { item_id: id }, 'manual')
  }
  if (kind === 'containers' && seg[3] === 'attachments' && method === 'POST') {
    const file = req.form?.get('file')
    if (!(file instanceof File)) throw new Error('缺少附件文件')
    return await storeAttachment(file, { container_id: id }, 'manual')
  }
  if (kind === 'recipes' && seg[3] === 'attachments' && method === 'POST') {
    const file = req.form?.get('file')
    if (!(file instanceof File)) throw new Error('缺少附件文件')
    return await storeAttachment(file, { recipe_id: id }, 'manual')
  }
  if (kind === 'items' && seg[3] === 'attachments' && method === 'GET') return itemAttachments(id) as unknown as Attachment[]
  if (kind === 'containers' && seg[3] === 'attachments' && method === 'GET') return containerAttachments(id) as unknown as Attachment[]
  if (kind === 'recipes' && seg[3] === 'attachments' && method === 'GET') return recipeAttachments(id) as unknown as Attachment[]
  if (kind === 'attachments' && seg[2] && !seg[3] && method === 'DELETE') {
    await removeAttachment(id)
    return { ok: true }
  }

  // ---- history ----
  if (path === '/api/history' && method === 'GET') {
    let rows = state.history
    if (query.get('container_id')) rows = rows.filter((h) => h.container_id === Number(query.get('container_id')))
    if (query.get('item_id')) rows = rows.filter((h) => h.item_id === Number(query.get('item_id')))
    const limit = num(query.get('limit'), 100)
    return rows.slice(0, limit).map(historyView)
  }
  if (kind === 'history' && seg[2] && seg[3] === 'undo' && method === 'POST') {
    const entry = state.history.find((h) => h.id === id)
    if (!entry) throw new Error('历史记录不存在')
    undoEntry(entry)
    return { ok: true }
  }

  // ---- recipes ----
  if (path === '/api/recipes' && method === 'GET') return sortRows(state.recipes).map(recipeView) as unknown as Recipe[]
  if (path === '/api/recipes' && method === 'POST') {
    const title = str(b.title).trim()
    if (!title) throw new Error('菜谱名称不能为空')
    const row = { id: nextId(), title, steps: str(b.steps), created_at: now(), updated_at: now() }
    state.recipes.push(row)
    logHistory({
      action_type: 'add', entity_type: 'recipe', entity_id: row.id, owner_id: 1,
      source: 'manual', description: `新建菜谱「${title}」`, before: null,
    })
    persist()
    return recipeView(row)
  }
  if (kind === 'recipes' && seg[2] && !seg[3]) {
    let recipe = state.recipes.find((r) => r.id === id)
    if (!recipe) {
      // 兼容先上传附件后保存的流程：以附件里带的 recipe_id 建档
      const att = state.attachments.find((a) => a.recipe_id === id)
      if (!att) throw new Error('菜谱不存在')
      recipe = { id, title: '未命名菜谱', steps: '', created_at: now(), updated_at: now() }
      state.recipes.push(recipe)
    }
    if (method === 'GET') return recipeView(recipe)
    if (method === 'PATCH') {
      const before = { ...recipe }
      if (b.title != null) recipe.title = str(b.title).trim() || recipe.title
      if (b.steps != null) recipe.steps = str(b.steps)
      recipe.updated_at = now()
      logHistory({
        action_type: 'update', entity_type: 'recipe', entity_id: recipe.id, owner_id: 1,
        source: 'manual', description: `修改菜谱「${recipe.title}」`, before,
      })
      persist()
      return recipeView(recipe)
    }
    if (method === 'DELETE') {
      for (const att of [...recipeAttachments(recipe.id)]) await removeAttachment(att.id)
      state.recipes = state.recipes.filter((r) => r.id !== recipe.id)
      logHistory({
        action_type: 'delete', entity_type: 'recipe', entity_id: recipe.id, owner_id: 1,
        source: 'manual', description: `删除菜谱「${recipe.title}」`, before: { ...recipe },
      })
      persist()
      return { ok: true }
    }
  }

  // ---- settings / mq / ai ----
  if (path === '/api/settings' && method === 'GET') {
    return { base_url: state.ai.base_url, model: state.ai.model, has_api_key: !!state.ai.api_key }
  }
  if (path === '/api/settings' && method === 'POST') {
    if (b.base_url != null) state.ai.base_url = str(b.base_url)
    if (b.model != null) state.ai.model = str(b.model)
    if (b.api_key) state.ai.api_key = str(b.api_key)
    persist()
    return { base_url: state.ai.base_url, model: state.ai.model, has_api_key: !!state.ai.api_key }
  }
  if (path === '/api/mq/status') {
    return { enabled: false, connected: false, url: '—', exchange: '—', queue: '—', last_error: '', client: '' }
  }
  if ((path === '/api/ai/chat' || path === '/api/chat') && method === 'POST') {
    return await aiChat(str(b.message))
  }
  if (path === '/api/ai/execute' && method === 'POST') {
    return aiExecute((b.action ?? {}) as { type: string; item_id?: number; container_id?: number; data?: Record<string, unknown> })
  }

  throw new Error(`本地模式暂不支持该接口：${method} ${path}`)
}

function itemsOfLength(containerId: number): number {
  return state.items.filter((i) => i.container_id === containerId).length
}
