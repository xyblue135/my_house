import { ref } from 'vue'

const toastText = ref('')
let toastTimer: number | undefined

export function useToast() {
  function toast(text: string) {
    toastText.value = text
    window.clearTimeout(toastTimer)
    toastTimer = window.setTimeout(() => { toastText.value = '' }, 2400)
  }
  return { toastText, toast }
}
