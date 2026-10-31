import { ref } from 'vue'
import { Capacitor } from '@capacitor/core'
import { CapacitorHttp } from '@capacitor/core'

/**
 * 朗读：默认用系统 TTS（安卓 App 用原生引擎，网页用 speechSynthesis），免费离线。
 * 可选接入「克隆音色」的自定义 API（默认关闭）：POST {text} 到配置的地址，
 * 期待返回音频字节（audio/mpeg 等），App 直接播放——具体音色/情感由该 API 服务决定。
 */
const ENABLED_KEY = 'myhouse.tts.enabled'
const CUSTOM_ON_KEY = 'myhouse.tts.customOn'
const CUSTOM_URL_KEY = 'myhouse.tts.customUrl'
const CUSTOM_KEY_SECRET = 'myhouse.tts.customKey'

function loadBool(key: string, fallback: boolean): boolean {
  const raw = localStorage.getItem(key)
  if (raw == null) return fallback
  return raw === '1'
}

export const ttsEnabled = ref(loadBool(ENABLED_KEY, true))
export const ttsCustomOn = ref(loadBool(CUSTOM_ON_KEY, false))
export const ttsCustomUrl = ref(localStorage.getItem(CUSTOM_URL_KEY) || '')
export const ttsCustomKey = ref(localStorage.getItem(CUSTOM_KEY_SECRET) || '')

function persist(key: string, value: string) {
  try { localStorage.setItem(key, value) } catch { /* 仅本次会话生效 */ }
}

export function setTtsEnabled(value: boolean) { ttsEnabled.value = value; persist(ENABLED_KEY, value ? '1' : '0') }
export function setTtsCustomOn(value: boolean) { ttsCustomOn.value = value; persist(CUSTOM_ON_KEY, value ? '1' : '0') }
export function setTtsCustomUrl(value: string) { ttsCustomUrl.value = value; persist(CUSTOM_URL_KEY, value) }
export function setTtsCustomKey(value: string) { ttsCustomKey.value = value; persist(CUSTOM_KEY_SECRET, value) }

const speaking = ref(false)

async function speakWithSystem(text: string): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    const { TextToSpeech } = await import('@capacitor-community/text-to-speech')
    await TextToSpeech.speak({ text, lang: 'zh-CN', rate: 1.0, pitch: 1.0 })
    return
  }
  const synth = window.speechSynthesis
  if (!synth) throw new Error('此浏览器不支持语音朗读')
  synth.cancel()
  const utter = new SpeechSynthesisUtterance(text)
  utter.lang = 'zh-CN'
  speaking.value = true
  utter.onend = () => { speaking.value = false }
  utter.onerror = () => { speaking.value = false }
  synth.speak(utter)
}

async function speakWithCustomApi(text: string): Promise<void> {
  const url = ttsCustomUrl.value.trim()
  if (!url) throw new Error('克隆音色 API 地址未配置')
  const body = JSON.stringify({ text })
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (ttsCustomKey.value.trim()) headers.Authorization = `Bearer ${ttsCustomKey.value.trim()}`
  let bytesBase64 = ''
  if (Capacitor.isNativePlatform()) {
    const res = await CapacitorHttp.request({
      url, method: 'POST', headers, data: body, responseType: 'arraybuffer',
      readTimeout: 120000, connectTimeout: 30000,
    })
    if (res.status < 200 || res.status >= 300) throw new Error(`克隆音色 API 返回 ${res.status}`)
    bytesBase64 = typeof res.data === 'string' ? res.data : ''
  } else {
    const res = await fetch(url, { method: 'POST', headers, body })
    if (!res.ok) throw new Error(`克隆音色 API 返回 ${res.status}`)
    bytesBase64 = bytesToBase64(new Uint8Array(await res.arrayBuffer()))
  }
  if (!bytesBase64) throw new Error('克隆音色 API 没有返回音频')
  const audio = new Audio(`data:audio/mpeg;base64,${bytesBase64}`)
  speaking.value = true
  audio.onended = () => { speaking.value = false }
  audio.onerror = () => { speaking.value = false; throw new Error('音频播放失败') }
  await audio.play()
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

/** 朗读一段文字；失败抛错由调用方 toast。 */
export async function speak(text: string): Promise<void> {
  if (!ttsEnabled.value || !text.trim()) return
  if (ttsCustomOn.value) {
    await speakWithCustomApi(text)
    return
  }
  await speakWithSystem(text)
}

export function useSpeakingState() { return speaking }
