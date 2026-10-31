/**
 * 云同步：本地数据（data.json + 附件）与 GitHub / Gitee 私有仓库同步。
 *  - 推送：一次提交写入 data.json、meta.json 与变更过的附件
 *  - 拉取：读取云端 data.json 与附件，整体替换本地（确认后）
 * 两个仓库（GitHub / Gitee）独立配置、独立验证，地址填仓库主页 URL 即可。
 */
import { CapacitorHttp } from '@capacitor/core'
import { state, replaceState, blobAll, persistNow, type LocalState } from './state'

export interface ProviderConfig {
  /** 仓库地址，如 https://github.com/xyblue135/my_house_data */
  url: string
  branch: string
  token: string
}

const CONFIG_KEY = 'myhouse.cloudProviders'
const LAST_SYNC_KEY = 'myhouse.lastSync'

export interface CloudProviders { github: ProviderConfig; gitee: ProviderConfig }

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
  const value = raw.trim().replace(/\/$/, '')
  if (!value) throw new Error(`${provider === 'github' ? 'GitHub' : 'Gitee'} 仓库地址未填写`)
  let url: URL
  try { url = new URL(value.includes('://') ? value : `https://${value}`) } catch { throw new Error('仓库地址格式不正确') }
  const seg = url.pathname.split('/').filter(Boolean)
  if (seg.length < 2) throw new Error('仓库地址需要包含所有者与仓库名，例如 https://github.com/owner/repo')
  const host = url.hostname
  let apiBase: string
  if (provider === 'github') {
    apiBase = host === 'github.com' ? 'https://api.github.com' : `https://${host}/api/v1`
  } else {
    apiBase = host === 'gitee.com' ? 'https://gitee.com/api/v5' : `https://${host}/api/v5`
  }
  return { apiBase: apiBase.replace(/\/$/, ''), owner: seg[0], repo: seg[1].replace(/\.git$/, ''), host }
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
  const repo = await requireOk(await request(provider, cfg, 'GET', ''), '验证仓库')
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
export async function pushToCloud(provider: 'github' | 'gitee', onProgress: (text: string) => void): Promise<string> {
  const cfg = providers[provider]
  if (!cfg.url || !cfg.token) throw new Error(`${provider === 'github' ? 'GitHub' : 'Gitee'} 的地址或令牌未配置`)
  await persistNow()
  onProgress('正在整理数据…')
  const safe: LocalState = JSON.parse(JSON.stringify(state))
  safe.ai = { base_url: safe.ai.base_url, model: safe.ai.model, api_key: '' } // 密钥绝不上云
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
  localStorage.setItem(`${LAST_SYNC_KEY}.${provider}.manifest`, JSON.stringify({ attachments: attHashes }))
  markSynced('push')
  return `${provider === 'github' ? 'GitHub' : 'Gitee'} 推送完成（${manifest.items} 物品 / ${manifest.containers} 箱子 / ${blobs.length} 附件）`
}

/** 拉取：用云端 data.json 与附件整体替换本地（调用前须让用户确认）。 */
export async function pullFromCloud(provider: 'github' | 'gitee', onProgress: (text: string) => void): Promise<string> {
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
  markSynced('pull')
  return `${provider === 'github' ? 'GitHub' : 'Gitee'} 拉取完成（${incoming.items.length} 物品 / ${incoming.containers.length} 箱子）`
}
