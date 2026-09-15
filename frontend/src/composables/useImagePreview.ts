import { computed, ref, type ComputedRef } from 'vue'

/**
 * 图片灯箱预览的全局共享状态（模块级单例，跨组件共享）。
 * 任何组件调用 open(urls, index) 都能打开同一个预览层；
 * ImagePreviewModal 挂载一次后监听这些状态。
 */
const images = ref<string[]>([])
const index = ref(0)
const isOpen = ref(false)

export interface ImagePreview {
  images: typeof images
  index: typeof index
  isOpen: typeof isOpen
  current: ComputedRef<string>
  open: (list: string[], startIndex?: number) => void
  close: () => void
  next: () => void
  prev: () => void
}

export function useImagePreview(): ImagePreview {
  const current = computed(() => images.value[index.value] || '')

  function open(list: string[], startIndex = 0) {
    const clean = list.filter(Boolean)
    if (!clean.length) return
    images.value = clean
    index.value = Math.max(0, Math.min(startIndex, clean.length - 1))
    isOpen.value = true
  }

  function close() { isOpen.value = false }
  function next() { if (images.value.length > 1) index.value = (index.value + 1) % images.value.length }
  function prev() { if (images.value.length > 1) index.value = (index.value - 1 + images.value.length) % images.value.length }

  return { images, index, isOpen, current, open, close, next, prev }
}
