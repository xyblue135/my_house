/**
 * 三盏状态灯：本机 / 云端 / AI。
 *  - 本机：数据在本机，常绿
 *  - 云端：最近一次 GitHub/Gitee 验证、推送或拉取的结果
 *  - AI：最近一次网关调用（对话/整理/测试）的结果
 * 状态持久化到 localStorage，重启后保留最近已知状态。
 */
import { reactive } from 'vue'

export type LightState = 'ok' | 'fail' | 'none' | 'testing'

const KEY = 'myhouse.statusLights'

function load(): { cloud: LightState; ai: LightState } {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}')
    const valid = (v: unknown): LightState =>
      v === 'ok' || v === 'fail' || v === 'testing' ? v : 'none'
    return { cloud: valid(raw.cloud), ai: valid(raw.ai) }
  } catch {
    return { cloud: 'none', ai: 'none' }
  }
}

export const lights = reactive(load())

export function setLight(kind: 'cloud' | 'ai', state: LightState): void {
  lights[kind] = state
  try { localStorage.setItem(KEY, JSON.stringify(lights)) } catch { /* 仅本次会话生效 */ }
}

export const LIGHT_LABEL: Record<LightState, string> = {
  ok: '正常',
  fail: '异常',
  none: '未配置',
  testing: '测试中…',
}

