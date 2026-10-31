import { ref } from 'vue'
import { Capacitor } from '@capacitor/core'
import { SpeechRecognition } from '@capacitor-community/speech-recognition'

/**
 * 语音输入：主力方向是安卓 App（Capacitor 原生语音识别插件，调系统语音服务）。
 * 网页端不做语音——`supported` 为 false 时界面直接隐藏麦克风按钮。
 *
 * 用法：toggle({ partial, final, error })；partial 实时回填识别中的文字，
 * 停止（自动静音停止或再次点麦克风）后以 final 交付最终文字。
 */
export function useVoiceInput() {
  const listening = ref(false)
  const supported = Capacitor.isNativePlatform()
  let lastText = ''

  async function toggle(handlers: {
    partial?: (text: string) => void
    final?: (text: string) => void
    error?: (message: string) => void
  }) {
    if (!supported) return
    if (listening.value) {
      await SpeechRecognition.stop()
      return
    }
    try {
      const perm = await SpeechRecognition.requestPermissions()
      if (perm.speechRecognition !== 'granted') {
        handlers.error?.('未获得麦克风权限，请在系统设置里允许')
        return
      }
      const avail = await SpeechRecognition.available()
      if (!avail.available) {
        handlers.error?.('此设备没有可用的语音识别服务')
        return
      }
      lastText = ''
      await SpeechRecognition.removeAllListeners()
      await SpeechRecognition.addListener('partialResults', (d: { matches: string[] }) => {
        const text = d.matches?.[0]
        if (text) {
          lastText = text
          handlers.partial?.(text)
        }
      })
      await SpeechRecognition.addListener('listeningState', (d: { status: 'started' | 'stopped' }) => {
        listening.value = d.status === 'started'
        if (d.status === 'stopped') {
          void SpeechRecognition.removeAllListeners()
          if (lastText) handlers.final?.(lastText)
        }
      })
      await SpeechRecognition.start({
        language: 'zh-CN',
        maxResults: 1,
        partialResults: true,
        popup: false,
      })
    } catch (error) {
      listening.value = false
      handlers.error?.((error as Error).message || '语音识别启动失败')
    }
  }

  return { listening, supported, toggle }
}
