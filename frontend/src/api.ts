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
  runtimeApiBase = value.trim().replace(/\/$/, '')
  if (runtimeApiBase) localStorage.setItem('itemnest.apiBase', runtimeApiBase)
  else localStorage.removeItem('itemnest.apiBase')
}

export function getLanToken(): string | null { return runtimeLanToken }
export function setLanToken(value: string | null): void {
  runtimeLanToken = value && value.trim() ? value.trim() : null
  if (runtimeLanToken) localStorage.setItem('itemnest.lanToken', runtimeLanToken)
  else localStorage.removeItem('itemnest.lanToken')
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
  const headers = new Headers(init.headers)
  if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  if (runtimeLanToken && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${runtimeLanToken}`)
    headers.set('X-ItemNest-Token', runtimeLanToken)
  }
  // 并发去重：仅对安全 GET 合并
  const dedupeKey = (!init.method || init.method.toUpperCase() === 'GET')
    ? `${path}|${init.body ? String(init.body) : ''}`
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
      const response = await fetch(apiUrl(path), { ...init, headers, signal: controller.signal })
      if (!response.ok) {
        let message = `请求失败 ${response.status}`
        try {
          const body = await response.json()
          message = body.detail || body.message || body.error || message
        } catch { /* keep HTTP status */ }
        throw new ApiError(message, response.status)
      }
      if (response.status === 204) return undefined as T
      const type = response.headers.get('content-type') || ''
      if (!type.includes('application/json')) return undefined as T
      return (await response.json()) as T
    } catch (ex) {
      if ((ex as Error).name === 'AbortError') {
        throw new ApiError(signal?.aborted ? '请求已取消' : '请求超时', 0)
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
