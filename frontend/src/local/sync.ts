/**
 * 云同步：本地数据（data.json + 附件）与 GitHub / Gitee 私有仓库同步。
 *  - 推送：一次提交写入 data.json、meta.json 与变更过的附件
 *  - 拉取：读取云端 data.json 与附件，整体替换本地（确认后）
 * 两个仓库（GitHub / Gitee）独立配置、独立验证，地址填仓库主页 URL 即可。
 */
import { CapacitorHttp } from '@capacitor/core'
import { state, replaceState, blobAll, persistNow, type LocalState } from './state'
import { snapshotAll } from './storage'
import { setLight } from './statusLights'

export interface ProviderConfig {
  /** 仓库地址，如 https://github.com/xyblue135/my_house_data */
  url: string
  branch: string
  token: string
}

const CONFIG_KEY = 'myhouse.cloudProviders'
const LAST_SYNC_KEY = 'myhouse.lastSync'

export interface CloudProviders { github: ProviderConfig; gitee: ProviderConfig }

/**
 * 初始化页的仓库预设：只预填地址与分支，令牌（PAT）**绝不预置**——
 * 它只能由用户手动输入、只存本机，不进代码、不进仓库。
 */
export const DEFAULT_PROVIDERS: CloudProviders = {
  github: { url: 'https://github.com/xyblue135/my_house_data', branch: 'main', token: '' },
  gitee: { url: '', branch: 'main', token: '' },
}

function loadConfig(): CloudProviders {
  try {
    const raw = JSON.parse(localStorage.getItem(CONFIG_KEY) || '{}')
    const pick = (v: Partial<ProviderConfig> | undefined): ProviderConfig => ({
      url: typeof v?.url === 'string' ? v.url : '',
      branch: typeof v?.branch === 'string' && v.branch ? v.branch : 'main',
      token: typeof v?.token === 'string' ? v.token : '',
    })
    return { github: pick(raw.github), gitee: pick(raw.gitee) }
  } catch {
    return { github: { url: '', branch: 'main', token: '' }, gitee: { url: '', branch: 'main', token: '' } }
  }
}

export const providers = loadConfig()

export function saveProviders(value: CloudProviders): void {
  Object.assign(providers, value)
  try { localStorage.setItem(CONFIG_KEY, JSON.stringify(providers)) } catch { /* 仅本次会话生效 */ }
}

export function lastSyncText(): string {
  return localStorage.getItem(LAST_SYNC_KEY) || '从未同步'
}
export function markSynced(kind: 'push' | 'pull'): void {
  localStorage.setItem(LAST_SYNC_KEY, `${kind === 'push' ? '推送' : '拉取'} ${new Date().toLocaleString()}`)
}

export interface ParsedRepo { apiBase: string; owner: string; repo: string; host: string }

/** 解析仓库主页 URL：github.com → api.github.com，gitee.com → gitee.com/api/v5 */
export function parseRepoUrl(raw: string, provider: 'github' | 'gitee'): ParsedRepo {
  const label = provider === 'github' ? 'GitHub' : 'Gitee'
  const value = raw.trim().replace(/\/$/, '')
  if (!value) throw new Error(`${label} 仓库地址未填写`)
  if (/\s/.test(value)) throw new Error('仓库地址不能包含空格或换行')
  let url: URL
  try { url = new URL(value.includes('://') ? value : `https://${value}`) } catch { throw new Error('仓库地址格式不正确，例如 https://github.com/owner/repo') }
  // 防混淆：地址里不允许内嵌账号密码（鉴权只走令牌）
  if (url.username || url.password) throw new Error('仓库地址不要包含账号密码，鉴权请填在「令牌」里')
  const host = url.hostname.toLowerCase()
  // 平台防填错：官方站互斥
  if (provider === 'github' && host === 'gitee.com') throw new Error('这是 Gitee 地址，请填到 Gitee 区域')
  if (provider === 'gitee' && host === 'github.com') throw new Error('这是 GitHub 地址，请填到 GitHub 区域')
  // 自建服务允许 http 局域网地址；官方站强制 https
  const isLan = host === 'localhost' || host.endsWith('.local') || /^192\.168\./.test(host) || /^10\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  if (!isLan && url.protocol !== 'https:') throw new Error(`${label} 仓库地址必须使用 https://`)
  const seg = url.pathname.split('/').filter(Boolean)
  if (seg.length < 2) throw new Error('仓库地址需要包含所有者与仓库名，例如 https://github.com/owner/repo')
  if (seg.length > 2) throw new Error('仓库地址只填到 仓库名 为止，不要包含路径')
  const [owner, repoRaw] = seg
  if (!/^[A-Za-z0-9._-]{1,100}$/.test(owner)) throw new Error('仓库所有者包含不支持的字符')
  const repo = repoRaw.replace(/\.git$/, '')
  if (!/^[A-Za-z0-9._-]{1,100}$/.test(repo)) throw new Error('仓库名包含不支持的字符')
  let apiBase: string
  if (provider === 'github') {
    apiBase = host === 'github.com' ? 'https://api.github.com' : `https://${host}/api/v1`
  } else {
    apiBase = host === 'gitee.com' ? 'https://gitee.com/api/v5' : `https://${host}/api/v5`
  }
  return { apiBase: apiBase.replace(/\/$/, ''), owner, repo, host }
}

// ---- 仓库绑定：防止换仓库后误拉取/误推送导致数据被覆盖 ----
const BIND_KEY = 'myhouse.repoBindings'

function loadBindings(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(BIND_KEY) || '{}') } catch { return {} }
}

/** 仓库唯一指纹：provider + host + owner + repo（小写） */
export function repoFingerprint(provider: 'github' | 'gitee', cfg: ProviderConfig): string {
  const r = parseRepoUrl(cfg.url, provider)
  return `${provider}:${r.host}/${r.owner.toLowerCase()}/${r.repo.toLowerCase()}`
}

export function getRepoBinding(provider: 'github' | 'gitee'): string | null {
  return loadBindings()[provider] ?? null
}

export function setRepoBinding(provider: 'github' | 'gitee', fingerprint: string): void {
  const b = loadBindings()
  b[provider] = fingerprint
  try { localStorage.setItem(BIND_KEY, JSON.stringify(b)) } catch { /* 仅本次会话生效 */ }
}

function repoUrl(cfg: ProviderConfig, provider: 'github' | 'gitee', sub: string): string {
  const { apiBase, owner, repo } = parseRepoUrl(cfg.url, provider)
  return `${apiBase}/repos/${owner}/${repo}${sub}`
}

function authHeaders(cfg: ProviderConfig, provider: 'github' | 'gitee', json: boolean): Record<string, string> {
  const headers: Record<string, string> = { Accept: 'application/vnd.github+json' }
  if (json) headers['Content-Type'] = 'application/json'
  if (provider === 'github') headers.Authorization = `Bearer ${cfg.token}`
  return headers
}

async function request(provider: 'github' | 'gitee', cfg: ProviderConfig, method: string, sub: string,
    options: { jsonBody?: unknown; rawResponse?: boolean } = {}): Promise<{ status: number; data: any }> {
  let url = repoUrl(cfg, provider, sub)
  if (provider === 'gitee') url += (url.includes('?') ? '&' : '?') + `access_token=${encodeURIComponent(cfg.token)}`
  const headers = authHeaders(cfg, provider, !!options.jsonBody)
  if (isNative) {
    const res = await CapacitorHttp.request({
      url, method, headers,
      data: options.jsonBody ?? undefined,
      responseType: options.rawResponse ? 'arraybuffer' : 'json',
      readTimeout: 120000, connectTimeout: 30000,
    })
    return { status: res.status, data: options.rawResponse && typeof res.data === 'string' ? base64ToBytes(res.data) : res.data }
  }
  const res = await fetch(url, {
    method, headers,
    body: options.jsonBody ? JSON.stringify(options.jsonBody) : undefined,
  })
  if (options.rawResponse) return { status: res.status, data: new Uint8Array(await res.arrayBuffer()) }
  const text = await res.text()
  let data: unknown = text
  try { data = JSON.parse(text) } catch { /* 保留原文 */ }
  return { status: res.status, data }
}

const isNative = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.() ?? false

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64.replace(/\s/g, ''))
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes.buffer as ArrayBuffer)
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function requireOk(result: { status: number; data: unknown }, what: string): Promise<any> {
  if (result.status < 200 || result.status >= 300) {
    const detail = typeof result.data === 'object' && result.data
      ? String((result.data as Record<string, unknown>).message ?? JSON.stringify(result.data)).slice(0, 160)
      : `HTTP ${result.status}`
    throw new Error(`${what}失败：${detail}`)
  }
  return result.data
}

export async function verifyProvider(provider: 'github' | 'gitee', cfg: ProviderConfig): Promise<string> {
  // 仓库是预设填好的，空令牌直接给一句人话，不必等 401
  if (!cfg.token.trim()) throw new Error('请先填写访问令牌（PAT）——仓库地址已预填，令牌只存本机')
  let repo: Record<string, unknown>
  try {
    repo = await requireOk(await request(provider, cfg, 'GET', ''), '验证仓库')
    setLight('cloud', 'ok')
  } catch (error) {
    setLight('cloud', 'fail')
    throw error
  }
  const meta = await request(provider, cfg, 'GET', '/contents/backup/meta.json').catch(() => ({ status: 0, data: null }))
  const name = String((repo as Record<string, unknown>).full_name ?? `${cfg.url}`)
  const hasBackup = meta.status >= 200 && meta.status < 300
  return `${name} 可访问（${(repo as Record<string, unknown>).private ? '私有' : '公开'}）${hasBackup ? '，含云端备份' : '，暂无云端备份'}`
}

interface SyncManifest {
  syncedAt: string
  items: number
  containers: number
  attachments: { id: number; hash: string }[]
}

/** 推送：data.json + meta.json + 变更过的附件，单次提交。 */
export async function pushToCloud(provider: 'github' | 'gitee', onProgress: (text: string) => void,
    guard: { confirmNewRepo?: (message: string) => boolean } = {}): Promise<string> {
  const cfg = providers[provider]
  if (!cfg.url || !cfg.token) throw new Error(`${provider === 'github' ? 'GitHub' : 'Gitee'} 的地址或令牌未配置`)
  // 仓库绑定防护：向与上次不同的仓库推送时需明确确认（防误选仓库把家庭数据传错地方）
  const fp = repoFingerprint(provider, cfg)
  const bound = getRepoBinding(provider)
  if (bound && bound !== fp) {
    const msg = `该仓库与上次同步的仓库不一致！

上次：${bound}
本次：${fp}

确定要把本机全部数据（含照片）上传到这个新仓库吗？`
    if (!guard.confirmNewRepo?.(msg)) throw new Error('已取消：仓库与上次不一致')
  }
  await persistNow()
  onProgress('正在整理数据…')
  const safe: LocalState = JSON.parse(JSON.stringify(state))
  safe.ai = { base_url: safe.ai.base_url, model: safe.ai.model, api_key: '' } // 密钥绝不上云
  delete safe.pcs // 电脑开关配置（含控制令牌）只留本机，整段不上云
  const blobs = await blobAll()

  const prevManifestRaw = localStorage.getItem(`${LAST_SYNC_KEY}.${provider}.manifest`)
  const prevHashes: Record<string, string> = prevManifestRaw
    ? (JSON.parse(prevManifestRaw).attachments ?? {}) : {}

  const tree: { path: string; mode: string; type: string; sha: string }[] = []
  const jsonBytes = new TextEncoder().encode(JSON.stringify(safe, null, 2))
  const jsonBlob = await requireOk(await request(provider, cfg, 'POST', '/git/blobs',
    { jsonBody: { content: bytesToBase64(jsonBytes), encoding: 'base64' } }), '上传数据')
  tree.push({ path: 'data.json', mode: '100644', type: 'blob', sha: String(jsonBlob.sha) })

  const attHashes: Record<string, string> = {}
  for (let i = 0; i < blobs.length; i++) {
    const { id } = blobs[i]
    const raw = new Uint8Array(await blobs[i].bytes.arrayBuffer())
    const hash = await sha256(raw)
    attHashes[String(id)] = hash
    if (prevHashes[String(id)] === hash) continue // 内容未变，跳过上传
    onProgress(`正在上传附件 ${i + 1}/${blobs.length}…`)
    const blob = await requireOk(await request(provider, cfg, 'POST', '/git/blobs',
      { jsonBody: { content: bytesToBase64(raw), encoding: 'base64' } }), `上传附件 ${id}`)
    tree.push({ path: `attachments/${id}`, mode: '100644', type: 'blob', sha: String(blob.sha) })
  }

  const manifest: SyncManifest = {
    syncedAt: new Date().toISOString(), items: safe.items.length, containers: safe.containers.length,
    attachments: Object.entries(attHashes).map(([id, hash]) => ({ id: Number(id), hash })),
  }
  const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest, null, 2))
  const manifestBlob = await requireOk(await request(provider, cfg, 'POST', '/git/blobs',
    { jsonBody: { content: bytesToBase64(manifestBytes), encoding: 'base64' } }), '上传同步信息')
  tree.push({ path: 'backup/meta.json', mode: '100644', type: 'blob', sha: String(manifestBlob.sha) })

  onProgress('正在生成提交…')
  let baseCommitSha = ''
  let baseTreeSha = ''
  const ref = await request(provider, cfg, 'GET', `/git/ref/heads/${cfg.branch}`)
  if (ref.status >= 200 && ref.status < 300) {
    baseCommitSha = String((ref.data as Record<string, Record<string, unknown>>)?.object?.sha ?? '')
    if (baseCommitSha) {
      const commit = await requireOk(await request(provider, cfg, 'GET', `/git/commits/${baseCommitSha}`), '读取最新提交')
      baseTreeSha = String(commit.tree?.sha ?? '')
    }
  }
  const treeRes = await requireOk(await request(provider, cfg, 'POST', '/git/trees',
    { jsonBody: baseTreeSha ? { base_tree: baseTreeSha, tree } : { tree } }), '创建目录树')
  const treeSha = String(treeRes.sha)

  if (!baseCommitSha) {
    const first = await requireOk(await request(provider, cfg, 'POST', '/git/commits',
      { jsonBody: { message: 'My House 数据同步（首次）', tree: treeSha, parents: [] } }), '创建首次提交')
    await requireOk(await request(provider, cfg, 'POST', '/git/refs',
      { jsonBody: { ref: `refs/heads/${cfg.branch}`, sha: String(first.sha) } }), '创建分支')
  } else {
    const commit = await requireOk(await request(provider, cfg, 'POST', '/git/commits',
      { jsonBody: { message: `My House 数据同步 ${new Date().toLocaleString()}`, tree: treeSha, parents: [baseCommitSha] } }), '创建提交')
    await requireOk(await request(provider, cfg, 'PATCH', `/git/refs/heads/${cfg.branch}`,
      { jsonBody: { sha: String(commit.sha), force: false } }), '更新分支')
  }
  setRepoBinding(provider, fp)
  localStorage.setItem(`${LAST_SYNC_KEY}.${provider}.manifest`, JSON.stringify({ attachments: attHashes }))
  markSynced('push')
  return `${provider === 'github' ? 'GitHub' : 'Gitee'} 推送完成（${manifest.items} 物品 / ${manifest.containers} 箱子 / ${blobs.length} 附件）`
}

/** 拉取：用云端 data.json 与附件整体替换本地（调用前须让用户确认）。 */
export async function pullFromCloud(provider: 'github' | 'gitee', onProgress: (text: string) => void,
    guard: { confirmCrossRepo?: (message: string) => boolean } = {}): Promise<string> {
  const cfg = providers[provider]
  if (!cfg.url || !cfg.token) throw new Error(`${provider === 'github' ? 'GitHub' : 'Gitee'} 的地址或令牌未配置`)
  onProgress('正在读取云端目录…')
  const head = await requireOk(await request(provider, cfg, 'GET', `/git/ref/heads/${cfg.branch}`), '读取分支')
  const commitSha = String((head as Record<string, Record<string, unknown>>)?.object?.sha ?? '')
  if (!commitSha) throw new Error('云端分支还没有任何提交，请先在其它设备推送')
  const tree = await requireOk(await request(provider, cfg, 'GET', `/git/trees/${commitSha}?recursive=1`), '读取目录树')
  const entries = (tree.tree ?? []) as { path: string; sha: string; type: string }[]
  const jsonEntry = entries.find((e) => e.path === 'data.json' && e.type === 'blob')
  if (!jsonEntry) throw new Error('云端没有 data.json（旧版备份仓库请用恢复功能或先推送一次）')

  onProgress('正在下载数据…')
  const jsonBlob = await requireOk(await request(provider, cfg, 'GET', `/git/blobs/${jsonEntry.sha}`), '下载数据')
  const incoming = JSON.parse(new TextDecoder().decode(base64ToBytes(String(jsonBlob.content ?? '')))) as LocalState

  const fp = repoFingerprint(provider, cfg)
  const bound = getRepoBinding(provider)
  if (bound && bound !== fp) {
    const msg = `该仓库与上次同步的仓库不一致！

拉取会用这个仓库的数据整体替换本机数据。
替换前会自动在本机保留一份快照（可在设置里恢复）。

确定继续吗？`
    if (!guard.confirmCrossRepo?.(msg)) throw new Error('已取消：仓库与上次不一致')
  }

  // 拉取前自动快照：误拉取可从 设置 → 恢复快照 找回
  onProgress('正在为本机数据建立安全快照…')
  await snapshotAll()

  const attEntries = entries.filter((e) => e.path.startsWith('attachments/') && e.type === 'blob')
  for (let i = 0; i < attEntries.length; i++) {
    onProgress(`正在下载附件 ${i + 1}/${attEntries.length}…`)
    const blob = await requireOk(await request(provider, cfg, 'GET', `/git/blobs/${attEntries[i].sha}`), '下载附件')
    const bytes = base64ToBytes(String(blob.content ?? ''))
    const id = Number(attEntries[i].path.split('/')[1])
    const meta = incoming.attachments.find((a) => a.id === id)
    if (meta) await (await import('./storage')).blobPut(id, { mime: meta.mime_type, bytes: new Blob([bytes as BlobPart], { type: meta.mime_type }) })
  }
  await replaceState(incoming)
  setRepoBinding(provider, fp)
  markSynced('pull')
  return `${provider === 'github' ? 'GitHub' : 'Gitee'} 拉取完成（${incoming.items.length} 物品 / ${incoming.containers.length} 箱子）`
}
