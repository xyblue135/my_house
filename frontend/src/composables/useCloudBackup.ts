import { ref } from 'vue'
import { CapacitorHttp } from '@capacitor/core'
import { apiUrl, getSessionToken } from '../api'

/**
 * 云备份：把「SQLite 快照 + 全部附件」提交到 GitHub / Gitee 仓库，
 * 恢复时从仓库取回并暂存到服务端，重启服务后整体替换。
 *
 * 仓库布局：
 *   backup/inventory.db            数据库一致性快照（VACUUM INTO）
 *   backup/attachments/<stored>    附件原文件
 *   backup/meta.json               备份时间与数量信息
 *
 * 提交走 Git Data API（blob → tree → commit → 更新 ref），一次备份一个提交。
 * provider 可切换 GitHub / Gitee，apiBase 可自定义（自建 Gitea 等兼容实现）。
 */

export interface CloudConfig {
  provider: 'github' | 'gitee'
  /** 留空用官方 API；自建 Gitea 等填自定义地址 */
  apiBase: string
  owner: string
  repo: string
  branch: string
  token: string
}

const KEY = 'myhouse.cloudBackup'
const DEFAULT_API: Record<CloudConfig['provider'], string> = {
  github: 'https://api.github.com',
  gitee: 'https://gitee.com/api/v5',
}

function load(): CloudConfig {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}')
    return {
      provider: raw.provider === 'gitee' ? 'gitee' : 'github',
      apiBase: typeof raw.apiBase === 'string' ? raw.apiBase : '',
      owner: typeof raw.owner === 'string' ? raw.owner : '',
      repo: typeof raw.repo === 'string' ? raw.repo : '',
      branch: typeof raw.branch === 'string' && raw.branch ? raw.branch : 'main',
      token: typeof raw.token === 'string' ? raw.token : '',
    }
  } catch {
    return { provider: 'github', apiBase: '', owner: '', repo: '', branch: 'main', token: '' }
  }
}

export const cloudConfig = ref<CloudConfig>(load())

export function saveCloudConfig(value: CloudConfig): void {
  cloudConfig.value = value
  try {
    localStorage.setItem(KEY, JSON.stringify(value))
  } catch { /* 仅本次会话生效 */ }
}

export const cloudBusy = ref(false)
export const cloudMessage = ref('')
export const lastBackupTime = ref(localStorage.getItem('myhouse.lastBackup') || '')

function apiBase(cfg: CloudConfig): string {
  const base = cfg.apiBase.trim().replace(/\/$/, '')
  return base || DEFAULT_API[cfg.provider]
}

function repoPath(cfg: CloudConfig, sub: string): string {
  return `${apiBase(cfg)}/repos/${cfg.owner}/${cfg.repo}${sub}`
}

function authUrl(cfg: CloudConfig, path: string): string {
  // gitee 的个人令牌走 query 参数；github 走 Bearer 头
  if (cfg.provider === 'gitee') {
    const sep = path.includes('?') ? '&' : '?'
    return `${repoPath(cfg, path)}${sep}access_token=${encodeURIComponent(cfg.token)}`
  }
  return repoPath(cfg, path)
}

function authHeaders(cfg: CloudConfig, extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { Accept: 'application/vnd.github+json', ...extra }
  if (cfg.provider === 'github') headers.Authorization = `Bearer ${cfg.token}`
  return headers
}

const isNative = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.() ?? false

interface HttpResult { status: number; data: unknown }

/** 原生走 CapacitorHttp（免 CORS），网页走 fetch。rawResponse=true 时返回二进制。 */
async function request(cfg: CloudConfig, method: string, path: string,
    options: { jsonBody?: unknown; rawResponse?: boolean } = {}): Promise<HttpResult> {
  const url = authUrl(cfg, path)
  const headers = authHeaders(cfg, options.jsonBody ? { 'Content-Type': 'application/json' } : undefined)
  if (isNative) {
    const res = await CapacitorHttp.request({
      url, method,
      headers,
      data: options.jsonBody ?? undefined,
      responseType: options.rawResponse ? 'arraybuffer' : 'json',
      readTimeout: 120000,
      connectTimeout: 30000,
    })
    let data: unknown = res.data
    if (options.rawResponse && typeof data === 'string') data = base64ToBytes(data)
    return { status: res.status, data }
  }
  const res = await fetch(url, {
    method,
    headers,
    body: options.jsonBody ? JSON.stringify(options.jsonBody) : undefined,
  })
  if (options.rawResponse) return { status: res.status, data: new Uint8Array(await res.arrayBuffer()) }
  const text = await res.text()
  let data: unknown = text
  try { data = JSON.parse(text) } catch { /* 保留原文 */ }
  return { status: res.status, data }
}

async function requireOk(result: HttpResult, what: string): Promise<any> {
  if (result.status < 200 || result.status >= 300) {
    const detail = typeof result.data === 'object' && result.data
      ? String((result.data as Record<string, unknown>).message ?? JSON.stringify(result.data)).slice(0, 160)
      : `HTTP ${result.status}`
    throw new Error(`${what}失败：${detail}`)
  }
  return (result.data ?? {}) as Record<string, unknown>
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

function base64ToBytes(base64: string): Uint8Array {
  const clean = base64.replace(/\s/g, '')
  const binary = atob(clean)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

/** 从 my_house 服务下载数据库快照与全部附件。 */
async function collectBackup(onProgress: (text: string) => void) {
  const token = getSessionToken()
  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {}
  onProgress('正在导出数据库快照…')
  const dbRes = await fetch(apiUrl('/api/backup/db'), { headers })
  if (!dbRes.ok) throw new Error(`数据库快照导出失败：HTTP ${dbRes.status}`)
  const dbBytes = new Uint8Array(await dbRes.arrayBuffer())

  const listRes = await fetch(apiUrl('/api/backup/attachments'), { headers })
  if (!listRes.ok) throw new Error(`附件清单获取失败：HTTP ${listRes.status}`)
  const list = (await listRes.json()) as { id: number; storedName: string }[]

  const photos: { name: string; bytes: Uint8Array }[] = []
  for (let i = 0; i < list.length; i++) {
    onProgress(`正在下载附件 ${i + 1}/${list.length}…`)
    const res = await fetch(apiUrl(`/api/attachments/${list[i].id}/content`), { headers })
    if (!res.ok) throw new Error(`附件 ${list[i].storedName} 下载失败：HTTP ${res.status}`)
    photos.push({ name: list[i].storedName, bytes: new Uint8Array(await res.arrayBuffer()) })
  }
  return { dbBytes, photos }
}

export async function backupToCloud(onProgress: (text: string) => void): Promise<string> {
  const cfg = cloudConfig.value
  if (!cfg.owner || !cfg.repo || !cfg.token) throw new Error('请先填写仓库所有者、仓库名和访问令牌')
  cloudBusy.value = true
  try {
    const { dbBytes, photos } = await collectBackup(onProgress)

    onProgress('正在创建 Git 对象…')
    const tree: { path: string; mode: string; type: string; sha: string }[] = []
    const dbBlob = await requireOk(await request(cfg, 'POST', '/git/blobs',
      { jsonBody: { content: bytesToBase64(dbBytes), encoding: 'base64' } }), '上传数据库')
    tree.push({ path: 'backup/inventory.db', mode: '100644', type: 'blob', sha: String(dbBlob.sha) })

    for (let i = 0; i < photos.length; i++) {
      onProgress(`正在上传附件 ${i + 1}/${photos.length}…`)
      const blob = await requireOk(await request(cfg, 'POST', '/git/blobs',
        { jsonBody: { content: bytesToBase64(photos[i].bytes), encoding: 'base64' } }), `上传附件 ${photos[i].name}`)
      tree.push({ path: `backup/attachments/${photos[i].name}`, mode: '100644', type: 'blob', sha: String(blob.sha) })
    }

    onProgress('正在生成提交…')
    const meta = {
      backedAt: new Date().toISOString(),
      dbBytes: dbBytes.length,
      attachments: photos.length,
    }
    const metaBlob = await requireOk(await request(cfg, 'POST', '/git/blobs',
      { jsonBody: { content: btoa(unescape(encodeURIComponent(JSON.stringify(meta, null, 2)))), encoding: 'base64' } }), '上传备份信息')
    tree.push({ path: 'backup/meta.json', mode: '100644', type: 'blob', sha: String(metaBlob.sha) })

    let baseCommitSha = ''
    let baseTreeSha = ''
    const ref = await request(cfg, 'GET', `/git/ref/heads/${cfg.branch}`)
    if (ref.status >= 200 && ref.status < 300) {
      baseCommitSha = String((ref.data as Record<string, Record<string, unknown>>).object?.sha ?? '')
      if (baseCommitSha) {
        const commit = await requireOk(await request(cfg, 'GET', `/git/commits/${baseCommitSha}`), '读取最新提交')
        baseTreeSha = String(commit.tree?.sha ?? '')
      }
    }

    const treeRes = await requireOk(await request(cfg, 'POST', '/git/trees',
      { jsonBody: baseTreeSha ? { base_tree: baseTreeSha, tree } : { tree } }), '创建目录树')
    const treeSha = String(treeRes.sha)

    if (!baseCommitSha) {
      // 分支不存在：以空树建首个提交
      const first = await requireOk(await request(cfg, 'POST', '/git/commits',
        { jsonBody: { message: 'My House 首次云备份', tree: treeSha, parents: [] } }), '创建首次提交')
      const created = await requireOk(await request(cfg, 'POST', `/git/refs`,
        { jsonBody: { ref: `refs/heads/${cfg.branch}`, sha: String(first.sha) } }), '创建分支')
      void created
      return new Date().toLocaleString()
    }

    const commit = await requireOk(await request(cfg, 'POST', '/git/commits',
      { jsonBody: { message: 'My House 云备份 ' + new Date().toLocaleString(), tree: treeSha, parents: [baseCommitSha] } }), '创建提交')
    await requireOk(await request(cfg, 'PATCH', `/git/refs/heads/${cfg.branch}`,
      { jsonBody: { sha: String(commit.sha), force: false } }), '更新分支')

    const time = new Date().toLocaleString()
    lastBackupTime.value = time
    localStorage.setItem('myhouse.lastBackup', time)
    return time
  } finally {
    cloudBusy.value = false
  }
}

export async function restoreFromCloud(onProgress: (text: string) => void): Promise<string> {
  const cfg = cloudConfig.value
  if (!cfg.owner || !cfg.repo || !cfg.token) throw new Error('请先填写仓库所有者、仓库名和访问令牌')
  cloudBusy.value = true
  try {
    onProgress('正在读取云端目录…')
    const head = await requireOk(await request(cfg, 'GET', `/git/ref/heads/${cfg.branch}`), '读取分支')
    const commitSha = String((head as Record<string, Record<string, unknown>>).object?.sha ?? '')
    if (!commitSha) throw new Error('云端分支还没有任何提交')
    const tree = await requireOk(await request(cfg, 'GET', `/git/trees/${commitSha}?recursive=1`), '读取目录树')
    const entries = (tree.tree ?? []) as { path: string; sha: string; type: string }[]
    const dbEntry = entries.find((e) => e.path === 'backup/inventory.db' && e.type === 'blob')
    if (!dbEntry) throw new Error('云端仓库里没有 backup/inventory.db，请先备份')

    onProgress('正在下载数据库…')
    const dbBlob = await requireOk(await request(cfg, 'GET', `/git/blobs/${dbEntry.sha}`), '下载数据库')
    const dbContent = String(dbBlob.content ?? '').replace(/\s/g, '')
    const dbBytes = base64ToBytes(dbContent)

    await requireOk(await requestMyHouse('/api/backup/restore/begin', { jsonBody: {} }), '初始化恢复')
    onProgress('正在暂存数据库…')
    await requireOk(await uploadRestoreFile('db', 'inventory.db', dbBytes), '暂存数据库')
    const photoEntries = entries.filter((e) => e.path.startsWith('backup/attachments/') && e.type === 'blob')
    for (let i = 0; i < photoEntries.length; i++) {
      onProgress(`正在暂存附件 ${i + 1}/${photoEntries.length}…`)
      const entry = photoEntries[i]
      const blob = await requireOk(await request(cfg, 'GET', `/git/blobs/${entry.sha}`), `下载附件 ${entry.path}`)
      const bytes = base64ToBytes(String(blob.content ?? '').replace(/\s/g, ''))
      const name = entry.path.slice('backup/attachments/'.length)
      await requireOk(await uploadRestoreFile('attachment', name, bytes), `暂存附件 ${name}`)
    }
    const apply = await requireOk(await requestMyHouse('/api/backup/restore/apply', { jsonBody: {} }), '应用恢复')
    return String(apply.message ?? '重启服务后生效')
  } finally {
    cloudBusy.value = false
  }
}

/** 恢复文件走 my_house 服务（同源连接，带会话令牌）。 */
async function uploadRestoreFile(kind: 'db' | 'attachment', name: string, bytes: Uint8Array): Promise<HttpResult> {
  const token = getSessionToken()
  const form = new FormData()
  form.append('kind', kind)
  if (kind === 'attachment') form.append('name', name)
  form.append('file', new Blob([bytes as BlobPart]), name)
  const res = await fetch(apiUrl(`/api/backup/restore/file`), {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body: form,
  })
  const text = await res.text()
  let data: unknown = text
  try { data = JSON.parse(text) } catch { /* 保留原文 */ }
  return { status: res.status, data }
}

async function requestMyHouse(path: string, options: { jsonBody: unknown }): Promise<HttpResult> {
  const token = getSessionToken()
  const res = await fetch(apiUrl(path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(options.jsonBody),
  })
  const text = await res.text()
  let data: unknown = text
  try { data = JSON.parse(text) } catch { /* 保留原文 */ }
  return { status: res.status, data }
}
