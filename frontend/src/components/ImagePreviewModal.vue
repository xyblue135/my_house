<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useImagePreview } from '../composables/useImagePreview'

const { images, index, isOpen, current, close, next, prev } = useImagePreview()

const MIN_SCALE = 0.5
const MAX_SCALE = 6

const scale = ref(1)
const tx = ref(0)
const ty = ref(0)
const rotation = ref(0)
const transforming = ref(false) // 拖拽/捏合过程中关闭过渡动画，保证跟手

const total = computed(() => images.value.length)

function resetView() {
  scale.value = 1
  tx.value = 0
  ty.value = 0
  rotation.value = 0
}

// 切换图片时重置视图
watch(index, resetView)
watch(isOpen, (open) => { if (!open) resetView() })

const imgStyle = computed(() => ({
  transform: `translate(${tx.value}px, ${ty.value}px) scale(${scale.value}) rotate(${rotation.value}deg)`,
}))

function clampScale(v: number) { return Math.min(MAX_SCALE, Math.max(MIN_SCALE, v)) }

function zoomBy(factor: number) {
  const next = clampScale(scale.value * factor)
  scale.value = next
  if (next <= 1) { tx.value = 0; ty.value = 0 }
}

function zoomIn() { zoomBy(1.25) }
function zoomOut() { zoomBy(0.8) }
function toggleZoom() { if (scale.value > 1) resetView(); else { scale.value = 2.5 } }
function rotate() { rotation.value = (rotation.value + 90) % 360 }

function onWheel(e: WheelEvent) {
  e.preventDefault()
  zoomBy(e.deltaY < 0 ? 1.12 : 0.89)
}

// ---- 手势：单指/鼠标拖拽平移 + 双指捏合缩放（Pointer Events 统一处理） ----
const pointers = new Map<number, { x: number; y: number }>()
let panStart = { x: 0, y: 0, tx: 0, ty: 0 }
let panning = false
let pinchStartDist = 0
let pinchStartScale = 1

function onPointerDown(e: PointerEvent) {
  ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
  transforming.value = true

  if (pointers.size === 1) {
    panning = true
    panStart = { x: e.clientX, y: e.clientY, tx: tx.value, ty: ty.value }
  } else if (pointers.size === 2) {
    panning = false
    const [a, b] = [...pointers.values()]
    pinchStartDist = Math.hypot(a.x - b.x, a.y - b.y) || 1
    pinchStartScale = scale.value
  }
}

function onPointerMove(e: PointerEvent) {
  if (!pointers.has(e.pointerId)) return
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })

  if (pointers.size === 1 && panning) {
    tx.value = panStart.tx + (e.clientX - panStart.x)
    ty.value = panStart.ty + (e.clientY - panStart.y)
  } else if (pointers.size === 2) {
    const [a, b] = [...pointers.values()]
    const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1
    const next = clampScale(pinchStartScale * (dist / pinchStartDist))
    scale.value = next
    if (next <= 1) { tx.value = 0; ty.value = 0 }
  }
}

function onPointerUp(e: PointerEvent) {
  pointers.delete(e.pointerId)
  if (pointers.size === 0) { panning = false; transforming.value = false }
  else if (pointers.size === 1) {
    // 从双指回到单指：重新校准平移起点，避免跳变
    const [p] = [...pointers.values()]
    panStart = { x: p.x, y: p.y, tx: tx.value, ty: ty.value }
    panning = true
  }
}

// ---- 键盘 ----
function onKey(e: KeyboardEvent) {
  if (!isOpen.value) return
  switch (e.key) {
    case 'Escape': close(); break
    case 'ArrowLeft': prev(); break
    case 'ArrowRight': next(); break
    case '+': case '=': zoomIn(); break
    case '-': zoomOut(); break
    case '0': resetView(); break
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKey)
  document.body.classList.add('preview-open')
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  document.body.classList.remove('preview-open')
})
</script>

<template>
  <div
    v-if="isOpen"
    class="preview-backdrop"
    @click.self="close"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerUp"
    @wheel.prevent="onWheel"
    @dblclick.prevent="toggleZoom">
    <img
      class="preview-img"
      :class="{ transforming }"
      :src="current"
      :style="imgStyle"
      draggable="false"
      alt="预览" />

    <div class="preview-toolbar" @pointerdown.stop @click.stop>
      <button class="preview-btn" @click="zoomOut" title="缩小">－</button>
      <span class="preview-scale">{{ Math.round(scale * 100) }}%</span>
      <button class="preview-btn" @click="zoomIn" title="放大">＋</button>
      <button class="preview-btn" @click="rotate" title="旋转">⟳</button>
      <button class="preview-btn" @click="resetView" title="重置">1:1</button>
    </div>

    <button class="preview-close" @pointerdown.stop @click.stop="close" title="关闭">×</button>

    <button
      v-if="total > 1"
      class="preview-nav prev"
      @pointerdown.stop @click.stop="prev" title="上一张">‹</button>
    <button
      v-if="total > 1"
      class="preview-nav next"
      @pointerdown.stop @click.stop="next" title="下一张">›</button>

    <div v-if="total > 1" class="preview-counter" @pointerdown.stop>{{ index + 1 }} / {{ total }}</div>
  </div>
</template>
