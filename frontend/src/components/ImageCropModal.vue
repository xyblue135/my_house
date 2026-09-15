<script setup lang="ts">
import { onMounted, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { fixImageOrientation } from '../utils/image'

const props = defineProps<{ file: File }>()
const emit = defineEmits<{ confirm: [File]; skip: []; cancel: [] }>()

const stageRef = ref<HTMLDivElement | null>(null)
const imgUrl = ref('')

// 图片在裁剪区内的显示区域（stage 坐标）
const imgRect = reactive({ x: 0, y: 0, w: 0, h: 0 })
// 选区（stage 坐标）
const crop = reactive({ x: 0, y: 0, w: 0, h: 0 })

let imgEl: HTMLImageElement | null = null
let dragging = false
let dragMode = 'move'
let startX = 0
let startY = 0
let startCrop = { x: 0, y: 0, w: 0, h: 0 }

const MIN = 24

function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)) }

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('图片解码失败'))
    img.src = url
  })
}

async function applyImage(url: string) {
  const img = await loadImage(url)
  imgEl = img
  const stage = stageRef.value
  if (!stage) return
  const sw = stage.clientWidth
  const sh = stage.clientHeight
  const scale = Math.min(sw / img.naturalWidth, sh / img.naturalHeight, 1)
  const w = img.naturalWidth * scale
  const h = img.naturalHeight * scale
  imgRect.x = (sw - w) / 2
  imgRect.y = (sh - h) / 2
  imgRect.w = w
  imgRect.h = h
  // 初始选区：图片 90% 居中
  const m = 0.9
  crop.w = w * m
  crop.h = h * m
  crop.x = imgRect.x + (w - crop.w) / 2
  crop.y = imgRect.y + (h - crop.h) / 2
}

async function rotate(dir: 1 | -1) {
  if (!imgEl) return
  const canvas = document.createElement('canvas')
  canvas.width = imgEl.naturalHeight
  canvas.height = imgEl.naturalWidth
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.translate(canvas.width / 2, canvas.height / 2)
  ctx.rotate((dir * Math.PI) / 2)
  ctx.drawImage(imgEl, -imgEl.naturalWidth / 2, -imgEl.naturalHeight / 2)
  const dataUrl = canvas.toDataURL('image/jpeg', 0.95)
  // 关键：旋转后必须同步更新 imgUrl，否则 <img> 仍显示旧图，
  // 却被 applyImage 套上新尺寸（宽高已交换），旧图被拉伸变形。
  if (imgUrl.value) URL.revokeObjectURL(imgUrl.value)
  imgUrl.value = dataUrl
  await applyImage(dataUrl)
}

function onPointerDown(e: PointerEvent, mode: string) {
  dragging = true
  dragMode = mode
  startX = e.clientX
  startY = e.clientY
  startCrop = { x: crop.x, y: crop.y, w: crop.w, h: crop.h }
  const target = e.currentTarget as Element | null
  if (target && target.setPointerCapture) {
    try { target.setPointerCapture(e.pointerId) } catch { /* ignore */ }
  }
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
  window.addEventListener('pointercancel', onPointerUp)
}

function onPointerMove(e: PointerEvent) {
  if (!dragging) return
  const dx = e.clientX - startX
  const dy = e.clientY - startY
  if (dragMode === 'move') {
    crop.x = clamp(startCrop.x + dx, imgRect.x, imgRect.x + imgRect.w - crop.w)
    crop.y = clamp(startCrop.y + dy, imgRect.y, imgRect.y + imgRect.h - crop.h)
    return
  }
  let { x, y, w, h } = startCrop
  if (dragMode.includes('e')) w = startCrop.w + dx
  if (dragMode.includes('s')) h = startCrop.h + dy
  if (dragMode.includes('w')) { x = startCrop.x + dx; w = startCrop.w - dx }
  if (dragMode.includes('n')) { y = startCrop.y + dy; h = startCrop.h - dy }
  // 最小尺寸约束
  if (w < MIN) { if (dragMode.includes('w')) x -= MIN - w; w = MIN }
  if (h < MIN) { if (dragMode.includes('n')) y -= MIN - h; h = MIN }
  // 夹紧在图片显示区域内
  const maxX = imgRect.x + imgRect.w
  const maxY = imgRect.y + imgRect.h
  x = clamp(x, imgRect.x, maxX - w)
  y = clamp(y, imgRect.y, maxY - h)
  w = clamp(w, MIN, maxX - x)
  h = clamp(h, MIN, maxY - y)
  crop.x = x; crop.y = y; crop.w = w; crop.h = h
}

function onPointerUp() {
  dragging = false
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
  window.removeEventListener('pointercancel', onPointerUp)
}

function filename() {
  const base = (props.file.name || 'photo').replace(/\.[^.]+$/, '') || 'photo'
  return `${base}.jpg`
}

async function confirm() {
  if (!imgEl) return
  const sx = (crop.x - imgRect.x) / imgRect.w * imgEl.naturalWidth
  const sy = (crop.y - imgRect.y) / imgRect.h * imgEl.naturalHeight
  const sw = crop.w / imgRect.w * imgEl.naturalWidth
  const sh = crop.h / imgRect.h * imgEl.naturalHeight
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(sw))
  canvas.height = Math.max(1, Math.round(sh))
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.drawImage(imgEl, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height)
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.92))
  if (!blob) return
  emit('confirm', new File([blob], filename(), { type: 'image/jpeg' }))
}

async function loadFile(file: File) {
  const oriented = await fixImageOrientation(file)
  if (imgUrl.value) URL.revokeObjectURL(imgUrl.value)
  imgUrl.value = URL.createObjectURL(oriented)
  try { await applyImage(imgUrl.value) } catch { /* ignore decode errors */ }
}

onMounted(() => { loadFile(props.file) })

// 队列里切到下一张图时 props.file 会变，组件不重挂载，需要手动重新加载
watch(() => props.file, (f) => { loadFile(f) })

onBeforeUnmount(() => {
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
  window.removeEventListener('pointercancel', onPointerUp)
  if (imgUrl.value) URL.revokeObjectURL(imgUrl.value)
})
</script>

<template>
  <div class="modal-backdrop crop-backdrop" @click.self="emit('cancel')">
    <div class="modal crop-modal">
      <div class="modal-head">
        <div><p class="eyebrow">CROP</p><h3>裁剪图片</h3></div>
        <button class="icon-btn" @click="emit('cancel')">×</button>
      </div>

      <div class="crop-stage" ref="stageRef">
        <img class="crop-img" :src="imgUrl" alt=""
          :style="{ left: imgRect.x + 'px', top: imgRect.y + 'px', width: imgRect.w + 'px', height: imgRect.h + 'px' }" />
        <div v-if="imgRect.w" class="crop-box" :style="{ left: crop.x + 'px', top: crop.y + 'px', width: crop.w + 'px', height: crop.h + 'px' }"
          @pointerdown.prevent="onPointerDown($event, 'move')">
          <span v-for="h in ['nw','n','ne','e','se','s','sw','w']" :key="h" class="crop-handle" :class="'h-' + h"
            @pointerdown.prevent.stop="onPointerDown($event, h)"></span>
        </div>
      </div>

      <div class="crop-toolbar">
        <button type="button" class="outline-btn compact" @click="rotate(-1)">⟲ 左转</button>
        <button type="button" class="outline-btn compact" @click="rotate(1)">⟳ 右转</button>
        <span class="grow"></span>
        <button type="button" class="outline-btn" @click="emit('skip')">用原图</button>
        <button class="primary-btn" @click="confirm">裁剪完成</button>
      </div>
    </div>
  </div>
</template>
