/**
 * 电脑开关：局域网唤醒（WoL 魔术包，Android 原生 UDP 广播）+
 * 电脑端 pc-agent 的 睡眠/关机 指令（HTTP，令牌校验）。
 * 配置（含控制令牌）只存本机，云同步时整段剔除（见 sync.ts）。
 * 关机/睡眠的执行命令由电脑端脚本按自身系统选择，App 无需区分 Windows/Linux。
 */
import { Capacitor, CapacitorHttp, registerPlugin } from '@capacitor/core'
import { state, nextId, persist, type PcHostRow } from './state'

export type { PcHostRow }

const isNative = Capacitor.isNativePlatform()

interface WakeOnLanPlugin {
  send(options: { mac: string; ip?: string }): Promise<{ ok: boolean; targets?: number }>
}
const wol = registerPlugin<WakeOnLanPlugin>('WakeOnLan')

export const DEFAULT_PC_PORT = 31880

export function normalizeMac(raw: string): string {
  const hex = raw.replace(/[^0-9a-fA-F]/g, '')
  if (hex.length !== 12) throw new Error('MAC 地址应为 12 位十六进制（如 AA:BB:CC:DD:EE:FF）')
  return (hex.toUpperCase().match(/../g) ?? []).join(':')
}

export function pcHosts(): PcHostRow[] {
  return state.pcs ?? []
}

export function savePcHost(row: Omit<PcHostRow, 'id'> & { id?: number | null }): PcHostRow {
  const clean: PcHostRow = {
    id: row.id ?? nextId(),
    name: row.name.trim() || '我的电脑',
    mac: normalizeMac(row.mac),
    ip: row.ip.trim(),
    port: row.port > 0 ? row.port : DEFAULT_PC_PORT,
    token: row.token.trim(),
  }
  state.pcs = [...pcHosts().filter((h) => h.id !== clean.id), clean]
  persist()
  return clean
}

export function deletePcHost(id: number): void {
  state.pcs = pcHosts().filter((h) => h.id !== id)
  persist()
}

/** 唤醒：发魔术包（手机 App 内可用；浏览器发不了 UDP 广播）。 */
export async function wakePc(host: PcHostRow): Promise<string> {
  if (!isNative) throw new Error('网络唤醒需在手机 App 内使用（浏览器发不了 UDP 广播）')
  const res = await wol.send({ mac: host.mac, ip: host.ip })
  return `唤醒包已发往「${host.name}」（${res.targets ?? 1} 个广播地址），稍等约半分钟开机`
}

function agentUrl(host: PcHostRow, path: string): string {
  if (!host.ip) throw new Error(`「${host.name}」还没填 IP 地址`)
  return `http://${host.ip}:${host.port || DEFAULT_PC_PORT}${path}`
}

async function agentRequest(
  host: PcHostRow, path: string, method: 'GET' | 'POST', body?: Record<string, unknown>,
): Promise<{ os?: string; error?: string }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (path !== '/health') {
    if (!host.token) throw new Error(`「${host.name}」还没填控制令牌（要和电脑端 pc_agent 设置的一致）`)
    headers['X-Agent-Token'] = host.token
  }
  try {
    if (isNative) {
      const r = await CapacitorHttp.request({
        url: agentUrl(host, path), method, headers,
        data: body ?? undefined, responseType: 'json',
        readTimeout: 10000, connectTimeout: 4000,
      })
      if (r.status === 403) throw new Error('控制令牌不对：手机里填的令牌要和电脑端 pc_agent 的一致')
      if (r.status !== 200) throw new Error(`电脑端返回 HTTP ${r.status}`)
      return (typeof r.data === 'string' ? JSON.parse(r.data) : r.data) ?? {}
    }
    const r = await fetch(agentUrl(host, path), {
      method, headers, body: body ? JSON.stringify(body) : undefined,
    })
    const text = await r.text()
    if (r.status === 403) throw new Error('控制令牌不对：手机里填的令牌要和电脑端 pc_agent 的一致')
    if (r.status !== 200) throw new Error(`电脑端返回 HTTP ${r.status}`)
    try { return JSON.parse(text) } catch { return {} }
  } catch (error) {
    const message = (error as Error).message || ''
    if (message.startsWith('http://') || message.includes('Network request failed') || message.includes('Failed to fetch')) {
      throw new Error(`连不上 ${host.ip}:${host.port || DEFAULT_PC_PORT}——确认电脑开着 pc_agent、手机连的是家里 Wi-Fi`)
    }
    throw error
  }
}

/** 探测电脑端 agent 是否在线（不需要令牌）。 */
export async function testPc(host: PcHostRow): Promise<string> {
  const data = await agentRequest(host, '/health', 'GET')
  const osName = data.os === 'windows' ? 'Windows' : data.os === 'linux' ? 'Linux' : '未知系统'
  return `「${host.name}」在线（${osName}）`
}

export async function sleepPc(host: PcHostRow): Promise<string> {
  await agentRequest(host, '/sleep', 'POST', {})
  return `已通知「${host.name}」睡眠，可用「唤醒」或按电源键恢复`
}

export async function shutdownPc(host: PcHostRow): Promise<string> {
  await agentRequest(host, '/shutdown', 'POST', {})
  return `已通知「${host.name}」关机（几秒内断电）`
}
