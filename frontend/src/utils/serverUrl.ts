/** Keep IPv6 brackets/ports intact. The API is hosted at the origin root. */
export function normalizeServerUrl(value: string): string {
  const input = value.trim()
  if (!input) return ''
  let url: URL
  try { url = new URL(input) }
  catch { throw new Error('请输入完整服务地址，例如 https://items.example.com；IPv6 地址需要加 [ ]') }
  if (!['https:', 'http:'].includes(url.protocol)) throw new Error('服务地址必须以 https:// 或 http:// 开头')
  if (url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) {
    throw new Error('服务地址只填写域名或 IP 和端口，不要包含路径、密钥或其他参数')
  }
  return url.origin
}
