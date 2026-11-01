/**
 * 检查更新：对接 GitHub Releases。
 *  - App 启动时静默检查（24 小时节流），发现新版本提示一次
 *  - 设置页可手动「检查更新」，展示版本号、更新说明与 APK 下载链接
 *
 * 仓库地址可在设置里修改（默认为官方仓库）。公开仓库无需令牌；
 * 私有仓库的检查更新需要把令牌也填入下方更新令牌（只存本机）。
 */
import { ref } from 'vue'
import { setLight } from '../local/statusLights'
import { providers, verifyProvider } from '../local/sync'
import { state } from '../local/state'
import { aiTest } from '../local/ai'

export const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0'

const UPDATE_REPO_KEY = 'myhouse.updateRepo'
const LAST_CHECK_KEY = 'myhouse.update.lastCheck'
const DAY = 24 * 60 * 60 * 1000

export interface UpdateInfo {
  available: boolean
  version: string
  notes: string
  apkUrl: string | null
  releaseUrl: string
}

function loadRepo(): string {
  return localStorage.getItem(UPDATE_REPO_KEY) || 'https://github.com/xyblue135/my_house'
}

export const updateRepo = ref(loadRepo())

export function setUpdateRepo(value: string): void {
  updateRepo.value = value.trim()
  try { localStorage.setItem(UPDATE_REPO_KEY, updateRepo.value) } catch { /* 仅本次会话生效 */ }
}

function parseRepo(raw: string): { owner: string; repo: string } {
  const m = raw.trim().replace(/\/$/, '').match(/github\.com\/([^/]+)\/([^/]+)$/i)
  if (!m) throw new Error('更新仓库地址需为 https://github.com/所有者/仓库')
  return { owner: m[1], repo: m[2].replace(/\.git$/, '') }
}

/** 比较语义化版本：a 是否比 b 新（v 前缀均可）。 */
export function isNewerVersion(a: string, b: string): boolean {
  const pa = a.replace(/^v/i, '').split('.').map(Number)
  const pb = b.replace(/^v/i, '').split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    const x = pa[i] || 0
    const y = pb[i] || 0
    if (x !== y) return x > y
  }
  return false
}

async function fetchLatest(): Promise<{ tag: string; notes: string; apkUrl: string | null; htmlUrl: string }> {
  const { owner, repo } = parseRepo(updateRepo.value)
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json' },
  })
  if (res.status === 404) throw new Error('该仓库还没有发布过版本')
  if (res.status === 403 || res.status === 429) throw new Error('请求过于频繁或仓库不可读，稍后再试')
  if (!res.ok) throw new Error(`查询失败：HTTP ${res.status}`)
  const data = (await res.json()) as {
    tag_name: string; body?: string; html_url: string
    assets?: { name: string; browser_download_url: string }[]
  }
  const apk = (data.assets ?? []).find((a) => a.name.endsWith('.apk'))
  return {
    tag: data.tag_name,
    notes: (data.body ?? '').slice(0, 600),
    apkUrl: apk?.browser_download_url ?? null,
    htmlUrl: data.html_url,
  }
}

export const updateInfo = ref<UpdateInfo | null>(null)
export const updateError = ref('')

export async function checkForUpdate(): Promise<UpdateInfo> {
  updateError.value = ''
  const latest = await fetchLatest()
  const available = isNewerVersion(latest.tag, APP_VERSION)
  updateInfo.value = {
    available,
    version: latest.tag,
    notes: latest.notes,
    apkUrl: latest.apkUrl,
    releaseUrl: latest.htmlUrl,
  }
  try { localStorage.setItem(LAST_CHECK_KEY, String(Date.now())) } catch { /* ignore */ }
  return updateInfo.value
}

/** 启动时的静默检查：24 小时至多一次；结果存入 updateInfo 供设置页与顶栏提示。 */
export async function autoCheckOnLaunch(): Promise<void> {
  try {
    const last = Number(localStorage.getItem(LAST_CHECK_KEY) || 0)
    if (Date.now() - last < DAY) return
    await checkForUpdate()
  } catch { /* 静默失败：无网或仓库不可读时不打扰 */ }
}

export function shouldSuggestUpdate(): boolean {
  return !!updateInfo.value?.available
}

/**
 * 启动联通性测试：逐个测试已配置的云仓库与 AI 网关。
 * 测试期间对应灯闪烁（testing），结束按结果 ok / fail；未配置则灰。
 */
export async function runStartupTests(): Promise<void> {
  const configured = (['github', 'gitee'] as const).filter(
    (p) => providers[p].url.trim() && providers[p].token.trim(),
  )
  if (configured.length) {
    setLight('cloud', 'testing')
    const results = await Promise.allSettled(configured.map((p) => verifyProvider(p, providers[p])))
    setLight('cloud', results.some((r) => r.status === 'fulfilled') ? 'ok' : 'fail')
  } else {
    setLight('cloud', 'none')
  }
  if (state.ai.base_url.trim()) {
    setLight('ai', 'testing')
    try {
      const message = await aiTest()
      setLight('ai', message.startsWith('✓') ? 'ok' : 'fail')
    } catch {
      setLight('ai', 'fail')
    }
  } else {
    setLight('ai', 'none')
  }
}
