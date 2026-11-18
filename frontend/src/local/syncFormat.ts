/**
 * 云端仓库布局解析（纯函数，无网络/无浏览器依赖，便于单测）。
 *
 * 同一个数据仓库历史上出现过三种布局，拉取时都要能认：
 *  1. 手机格式（当前）：`data.json` + `attachments/<附件id>` + `backup/meta.json`
 *  2. 手机格式（旧版）：`backup/data.json` + `backup/attachments/<附件id>`
 *  3. 电脑端备份快照：`inventory.db` + `backup-meta.json` + `attachments/<容器或物品>/<文件>`
 * 布局 3 没有 data.json，只能靠电脑端导出一份，见 scripts/export-mobile-json.py。
 */

export interface TreeEntry {
  path: string
  sha: string
  type: string
}

/** 拉取时需要下载的附件：附件 id → 仓库里的真实路径。 */
export interface AttachmentPlan {
  id: number
  path: string
}

export interface AttachmentPlanResult {
  plan: AttachmentPlan[]
  /** 云端的附件元数据在，但仓库里找不到对应文件（历史遗留/手工删过）的附件 id。 */
  missing: number[]
}

const DATA_JSON_RE = /(^|\/)data\.json$/i
const DB_RE = /(^|\/)inventory\.db$/i

function isBlob(entry: TreeEntry): boolean {
  return entry.type === 'blob'
}

/** data.json 所在目录（'' 或 'backup/'，带结尾斜杠），用于拼同目录下的附件路径。 */
export function dirOfPath(path: string): string {
  const index = path.lastIndexOf('/')
  return index < 0 ? '' : path.slice(0, index + 1)
}

/**
 * 在云端目录树里挑出手机格式的 data.json：
 * 根目录优先 → `backup/data.json` → 其它任意位置的 `data.json`（路径最短者优先，结果稳定）。
 */
export function pickDataJson(entries: TreeEntry[]): TreeEntry | null {
  const hits = entries.filter((e) => isBlob(e) && DATA_JSON_RE.test(e.path))
  if (!hits.length) return null
  const rank = (path: string): number => (path === 'data.json' ? 0 : path === 'backup/data.json' ? 1 : 2)
  return [...hits].sort(
    (a, b) => rank(a.path) - rank(b.path) || a.path.length - b.path.length || a.path.localeCompare(b.path),
  )[0]
}

/** 仓库里是否有电脑端导出的一致性快照（inventory.db）。 */
export function hasServerSnapshot(entries: TreeEntry[]): boolean {
  return entries.some((e) => isBlob(e) && DB_RE.test(e.path))
}

/** 仓库顶层条目，用来在报错时告诉用户「这个仓库里到底有什么」。 */
export function topLevelNames(entries: TreeEntry[]): string[] {
  const names = new Set<string>()
  for (const e of entries) {
    const seg = e.path.split('/')[0]
    if (seg) names.add(e.type === 'tree' || e.path.includes('/') ? `${seg}/` : seg)
  }
  return [...names].sort((a, b) => a.localeCompare(b))
}

/**
 * 附件下载计划。
 * 附件行优先用 `stored_name`（电脑端备份会带，形如 `container-1/xxx.jpg`），
 * 其次回退到旧的 `attachments/<附件id>`；两种都找不到就记进 missing，不再静默跳过。
 */
export function planAttachmentDownloads(
  entries: TreeEntry[],
  attachments: { id: number; stored_name?: string | null }[],
  dataJsonPath = 'data.json',
): AttachmentPlanResult {
  const blobs = new Map<string, TreeEntry>()
  for (const e of entries) if (isBlob(e)) blobs.set(e.path, e)
  const here = dirOfPath(dataJsonPath)
  const roots = here && here !== '' ? [here, ''] : ['']

  const plan: AttachmentPlan[] = []
  const missing: number[] = []
  for (const att of attachments) {
    const stored = String(att.stored_name ?? '').replace(/^\/+/, '')
    const candidates: string[] = []
    for (const root of roots) {
      if (stored) candidates.push(`${root}attachments/${stored}`)
      candidates.push(`${root}attachments/${att.id}`)
    }
    const hit = candidates.find((path) => blobs.has(path))
    if (hit) plan.push({ id: att.id, path: hit })
    else missing.push(att.id)
  }
  return { plan, missing }
}

/** 没有 data.json 时给用户的解释：说清仓库里有什么、下一步该点哪里。 */
export function explainMissingDataJson(entries: TreeEntry[]): string {
  const top = topLevelNames(entries)
  const listing = top.length ? top.join('、') : '（仓库是空的）'
  if (hasServerSnapshot(entries)) {
    return [
      '这个仓库里只有电脑端的备份快照（inventory.db），没有手机能读的 data.json。',
      `当前内容：${listing}`,
      '处理办法：在电脑端执行一次「同步到仓库」（会同时写入 data.json），或在电脑上跑 scripts/export-mobile-json.py 生成后提交。',
      '注意：先不要在这台手机上点「推送到云端」——那会拿手机上现有的数据覆盖云端。',
    ].join('\n')
  }
  if (!top.length) return '云端仓库还是空的。请先在一台有数据的设备上点「推送到云端」。'
  return [
    '这个仓库里没有 data.json，可能选错了仓库或分支。',
    `当前内容：${listing}`,
    '请检查：仓库地址是否为本 App 的数据仓库、分支是否填对（默认 main）。',
  ].join('\n')
}

/** 拉取结果里的附件完整性提示（缺文件时给一句人话，而不是让用户以为图片丢了）。 */
export function describeAttachmentGap(missing: number[], downloaded: number): string {
  if (!missing.length) return ''
  return `有 ${missing.length} 个附件在云端找不到文件（已跳过，文字数据不受影响；可在电脑端重新推送补齐）`
}
