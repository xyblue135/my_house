/**
 * 数据访问层：单机模式。全部 /api/* 请求在本地解析（IndexedDB），
 * 云端同步走 src/local/sync.ts（GitHub / Gitee）。
 */
import { reactive } from 'vue'
import { localApi } from './local/localApi'
import { blobUrls } from './local/state'

export const connection = reactive({
  status: 'checking' as 'checking' | 'online' | 'offline',
  message: '正在加载数据…',
})

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
    this.name = 'ApiError'
  }
}

const inFlight = new Map<string, Promise<unknown>>()

export interface ApiOptions extends Omit<RequestInit, 'signal'> {
  /** 兼容旧调用签名（登录/上传），本地模式下忽略。 */
  timeoutMs?: number
  signal?: AbortSignal
  allowUnconnected?: boolean
}

/**
 * 通用请求方法：路径与返回结构同原服务端，但在本地解析。
 * - FormData（附件上传）与 JSON body 都支持。
 * - 同 path+method 的并发 GET 自动合并。
 */
export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const { signal } = options
  const method = (options.method || 'GET').toUpperCase()
  if (signal?.aborted) throw new ApiError('请求已取消', 0)

  const dedupeKey = method === 'GET' && !signal ? `${method}|${path}` : ''
  if (dedupeKey && inFlight.has(dedupeKey)) return inFlight.get(dedupeKey) as Promise<T>

  const run = (async (): Promise<T> => {
    let body: unknown = options.body
    let form: FormData | null = null
    if (options.body instanceof FormData) {
      form = options.body
      body = null
    } else if (typeof options.body === 'string' && options.body) {
      try { body = JSON.parse(options.body) } catch { body = options.body }
    }
    const [pathOnly, qs] = path.split('?')
    return await localApi({
      method, path: pathOnly, query: new URLSearchParams(qs || ''), body, form,
    }) as T
  })()

  if (dedupeKey) {
    inFlight.set(dedupeKey, run as Promise<unknown>)
    void run.finally(() => inFlight.delete(dedupeKey))
  }
  return run
}

/** AbortScope 保留原签名：本地操作瞬时完成，仅作兼容。 */
export class AbortScope {
  private controller = new AbortController()
  get signal(): AbortSignal { return this.controller.signal }
  abort(reason?: string): void {
    if (reason) this.controller.abort(reason)
    else this.controller.abort()
  }
}

export async function checkConnection(): Promise<void> {
  connection.status = 'online'
  connection.message = ''
}

/** 本地模式下 API 即路径本身（保留旧合同）。 */
export function apiUrl(path: string): string { return path }

/** 附件内容 URL，供 <img>/<a> 直接使用（本地对象 URL，启动时预生成）。 */
export function attachmentUrl(id: number | null | undefined): string {
  if (id == null) return ''
  return blobUrls.get(id) ?? ''
}
