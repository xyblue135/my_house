import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { normalizeServerUrl } from '../src/utils/serverUrl'

const native = vi.hoisted(() => vi.fn(() => false))
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: native } }))

beforeEach(() => {
  vi.resetModules()
  native.mockReturnValue(false)
  const data = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
    removeItem: (key: string) => data.delete(key),
  })
  vi.stubGlobal('window', { setTimeout, clearTimeout })
  vi.stubGlobal('fetch', vi.fn())
})
afterEach(() => vi.unstubAllGlobals())

describe('server addresses', () => {
  it('preserves IPv6 brackets and port, supports domains and IPv4', () => {
    expect(normalizeServerUrl(' https://[2001:db8::1]:8443/ ')).toBe('https://[2001:db8::1]:8443')
    expect(normalizeServerUrl('http://127.0.0.1:8765')).toBe('http://127.0.0.1:8765')
    expect(normalizeServerUrl('https://items.example.com/')).toBe('https://items.example.com')
    expect(normalizeServerUrl('')).toBe('')
  })
  it.each(['https://2001:db8::1:8443', 'javascript:alert(1)', 'https://user:secret@example.com', 'https://example.com/api', 'https://example.com?token=secret'])('rejects ambiguous or unsafe address %s', address => {
    expect(() => normalizeServerUrl(address)).toThrow()
  })
})

describe('online-only writes', () => {
  it('blocks writes before the authenticated connection succeeds', async () => {
    const { api } = await import('../src/api')
    await expect(api('/api/items', { method: 'POST', body: '{}' })).rejects.toThrow('尚未连接服务器')
    expect(fetch).not.toHaveBeenCalled()
  })
  it('verifies service and sends the key, then permits writes', async () => {
    const { api, setApiBase, setLanToken, checkConnection, connection } = await import('../src/api')
    setApiBase('https://[2001:db8::1]:8443')
    setLanToken('test-key')
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ service: 'myhouse', status: 'ok', api_version: 1 }))
    await checkConnection()
    expect(connection.status).toBe('online')
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe('https://[2001:db8::1]:8443/api/connection')
    expect(new Headers(vi.mocked(fetch).mock.calls[0][1]?.headers).get('Authorization')).toBe('Bearer test-key')
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ id: 123 }))
    expect(await api('/api/items', { method: 'POST', body: '{}' })).toEqual({ id: 123 })
  })
  it('does not replay an uncertain write; blocks later writes until reconnection', async () => {
    const { api, connection } = await import('../src/api')
    connection.status = 'online'
    vi.mocked(fetch).mockRejectedValue(new TypeError('network disconnected'))
    await expect(api('/api/items', { method: 'POST', body: '{}' })).rejects.toThrow('保存结果尚未确认')
    expect(connection.status).toBe('offline')
    await expect(api('/api/items', { method: 'POST', body: '{}' })).rejects.toThrow('尚未连接服务器')
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('wrong key keeps the client locked', async () => {
    const { checkConnection, connection } = await import('../src/api')
    vi.mocked(fetch).mockResolvedValue(Response.json({ message: 'invalid key' }, { status: 401 }))
    await expect(checkConnection()).rejects.toThrow('invalid key')
    expect(connection.status).toBe('unauthorized')
  })
  it('rejects a proxy login page instead of treating HTML as data', async () => {
    const { checkConnection, connection } = await import('../src/api')
    vi.mocked(fetch).mockResolvedValue(new Response('<html>Login</html>', { headers: { 'Content-Type': 'text/html' } }))
    await expect(checkConnection()).rejects.toThrow('没有返回我的家数据')
    expect(connection.status).toBe('offline')
  })
  it('native first launch needs an HTTPS server; it cannot use the bundled localhost', async () => {
    native.mockReturnValue(true)
    const { checkConnection, connection, setApiBase } = await import('../src/api')
    await expect(checkConnection()).rejects.toThrow('首次使用')
    expect(connection.status).toBe('setup')
    expect(() => setApiBase('http://[2001:db8::1]:8765')).toThrow('HTTPS')
    expect(fetch).not.toHaveBeenCalled()
  })
})
