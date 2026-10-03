import { reactive } from 'vue'
import { Capacitor } from '@capacitor/core'
import { normalizeServerUrl } from './utils/serverUrl'

export const connection = reactive({
  status: 'checking' as 'checking' | 'online' | 'offline' | 'unauthorized' | 'setup',
  message: '正在连接家庭服务器…',
})

const buildApiBase = String(import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')
let runtimeApiBase = localStorage.getItem('itemnest.apiBase')?.replace(/\/$/, '') ?? buildApiBase
// 局域网 token：和后端 LanAuthFilter 配套；只在用户主动设置后保存。
let runtimeLanToken: string | null = localStorage.getItem('itemnest.lanToken') || null

export function apiUrl(path: string): string {
  const normalized = path.startsWith('/') ? path : `/${path}`
  return `${runtimeApiBase}${normalized}`
}

export function getApiBase(): string { return runtimeApiBase }
export function setApiBase(value: string): void {
  const normalized = normalizeServerUrl(value)
  if (Capacitor.isNativePlatform() && normalized && !normalized.startsWith('https://')) {
    throw new Error('App 请使用 HTTPS 服务地址')
  }
  runtimeApiBase = normalized
  if (runtimeApiBase) localStorage.setItem('itemnest.apiBase', runtimeApiBase)
  else localStorage.removeItem('itemnest.apiBase')
}

export function getLanToken(): string | null { return runtimeLanToken }
export function setLanToken(value: string | null): void {
  runtimeLanToken = value && value.trim() ? value.trim() : null
  if (runtimeLanToken) localStorage.setItem('itemnest.lanToken', runtimeLanToken)
  else localStorage.removeItem('itemnest.lanToken')
}

/**
 * 附件内容 URL，供 <img>/<a> 直接使用。
 * <img> 标签不会带 Authorization 头，所以局域网模式下把 token 拼进 ?token=，
 * 后端 LanAuthFilter 会从 query 里识别（三种来源之一）。
 */
export function attachmentUrl(id: number | null | undefined): string {
  if (id == null) return ''
  const base = apiUrl(`/api/attachments/${id}/content`)
  return runtimeLanToken ? `${base}?token=${encodeURIComponent(runtimeLanToken)}` : base
}

export interface ApiOptions extends Omit<RequestInit, 'signal'> {
  /** 请求超时毫秒数；默认 15000。 */
  timeoutMs?: number
  /** 用于取消请求；例如切换视图时统一 abort。 */
  signal?: AbortSignal
}

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
    this.name = 'ApiError'
  }
}

const inFlight = new Map<string, Promise<unknown>>()

/**
 * 通用请求方法。
 * - 自动注入 Content-Type（JSON）和 LAN token（如果有）。
 * - 支持 timeout 和 AbortSignal。
 * - 同 path + method + body 指纹相同的并发请求会自动合并（in-flight deduplication），
 *   减少 dashboard/items 反复拉取。
 */
export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const { timeoutMs = 15000, signal, ...init } = options
  const method = (init.method || 'GET').toUpperCase()
  const writing = !['GET', 'HEAD', 'OPTIONS'].includes(method)
  if (writing && connection.status !== 'online') {
    throw new ApiError('尚未连接服务器，暂时无法保存。请先重新连接。', 0)
  }
  const headers = new Headers(init.headers)
  if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  if (runtimeLanToken && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${runtimeLanToken}`)
  }
  // 并发去重：仅对安全 GET 合并
  const dedupeKey = (method === 'GET' && !signal)
    ? `${runtimeApiBase}|${runtimeLanToken}|${path}`
    : ''
  if (dedupeKey && inFlight.has(dedupeKey)) {
    return inFlight.get(dedupeKey) as Promise<T>
  }

  const controller = new AbortController()
  const onSignalAbort = () => controller.abort()
  if (signal) {
    if (signal.aborted) controller.abort()
    else signal.addEventListener('abort', onSignalAbort, { once: true })
  }
  const timer = window.setTimeout(() => controller.abort(), timeoutMs)

  const promise = (async (): Promise<T> => {
    try {
      const response = await fetch(apiUrl(path), { ...init, headers, cache: 'no-store', signal: controller.signal })
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          connection.status = 'unauthorized'
          connection.message = '连接未获授权，请检查家庭访问密钥和服务地址。'
        } else if (response.status >= 500) {
          connection.status = 'offline'
          connection.message = '服务器暂时无法处理请求，请稍后重新连接。'
        }
        let message = `请求失败 ${response.status}`
        try {
          const body = await response.json()
          message = body.detail || body.message || body.error || message
        } catch { /* keep HTTP status */ }
        throw new ApiError(message, response.status)
      }
      if (response.status === 204) return undefined as T
      const type = response.headers.get('content-type') || ''
      if (!type.includes('application/json')) {
        connection.status = 'offline'
        connection.message = '该地址没有返回物栈数据，请检查服务地址和代理配置。'
        throw new ApiError(connection.message, 0)
      }
      return (await response.json()) as T
    } catch (ex) {
      if ((ex as Error).name === 'AbortError') {
        if (signal?.aborted) throw new ApiError('请求已取消', 0)
        connection.status = 'offline'
        connection.message = writing ? '保存结果尚未确认，请重连后检查记录，避免重复提交。' : '连接服务器超时。'
        throw new ApiError(connection.message, 0)
      }
      if (!(ex instanceof ApiError)) {
        connection.status = 'offline'
        connection.message = writing ? '保存结果尚未确认，请重连后检查记录，避免重复提交。' : '无法连接服务器，请检查网络和服务地址。'
        throw new ApiError(connection.message, 0)
      }
      throw ex
    } finally {
      window.clearTimeout(timer)
      if (signal) signal.removeEventListener('abort', onSignalAbort)
      if (dedupeKey) inFlight.delete(dedupeKey)
    }
  })()

  if (dedupeKey) inFlight.set(dedupeKey, promise)
  return promise
}

/** A successful authenticated probe is required before any write. No offline queue/replay. */
export async function checkConnection(): Promise<void> {
  if (Capacitor.isNativePlatform() && !runtimeApiBase) {
    connection.status = 'setup'
    connection.message = '首次使用，请连接你的家庭服务器。'
    throw new ApiError(connection.message, 0)
  }
  if (connection.status !== 'online') connection.status = 'checking'
  try {
    const base = normalizeServerUrl(runtimeApiBase)
    runtimeApiBase = base
    if (Capacitor.isNativePlatform() && !base.startsWith('https://')) {
      throw new Error('App 请使用 HTTPS 服务地址')
    }
    const result = await api<{ service: string; status: string; api_version: number }>('/api/connection', { timeoutMs: 8000 })
    if (result?.service !== 'itemnest' || result.status !== 'ok' || result.api_version !== 1) {
      throw new Error('服务地址不正确，或服务器需要更新。')
    }
    connection.status = 'online'
    connection.message = ''
  } catch (error) {
    if (connection.status === 'checking' || connection.status === 'online') {
      connection.status = 'offline'
      connection.message = (error as Error).message
    }
    throw error
  }
}

/**
 * 创建一个 AbortController，调用其 abort 时会取消所有挂在这个 controller 上的请求。
 * 用法：const ac = new AbortScope(); await api('/x', { signal: ac.signal }); ... ac.abort();
 */
export class AbortScope {
  private controller = new AbortController()
  get signal(): AbortSignal { return this.controller.signal }
  abort(reason?: string): void {
    if (reason) this.controller.abort(reason)
    else this.controller.abort()
  }
}
