<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'

const props = defineProps<{ file: File }>()
const emit = defineEmits<{ confirm: [File]; skip: []; cancel: [] }>()

const stageRef = ref<HTMLDivElement | null>(null)
const imgUrl = ref('')
const processing = ref(false)

// 图片在裁剪区内的显示区域（stage 坐标）
const imgRect = reactive({ x: 0, y: 0, w: 0, h: 0 })
// 选区（stage 坐标）
const crop = reactive({ x: 0, y: 0, w: 0, h: 0 })

// 绘制源：优先 ImageBitmap（createImageBitmap 原生纠正 EXIF，
// 避免打开时对 1200 万像素原图做一次完整的重编码）
let drawSource: ImageBitmap | HTMLImageElement | null = null
let dragging = false
let dragMode = 'move'
let startX = 0
let startY = 0
let startCrop = { x: 0, y: 0, w: 0, h: 0 }
let objectUrl: string | null = null

const MIN = 24

function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)) }

function dims(): { w: number; h: number } {
  if (!drawSource) return { w: 1, h: 1 }
  return { w: drawSource.width, h: drawSource.height }
}

async function sourceFromBlob(blob: Blob): Promise<void> {
  try {
    drawSource = await createImageBitmap(blob, { imageOrientation: 'from-image' })
    return
  } catch { /* 老内核不支持，回退 <img> 解码 */ }
  const url = URL.createObjectURL(blob)
  try {
    drawSource = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image()
      image.onload = () => resolve(image)
      image.onerror = () => reject(new Error('图片解码失败'))
      image.src = url
    })
  } finally {
    URL.revokeObjectURL(url)
  }
}

async function applySource(): Promise<void> {
  if (!drawSource || !stageRef.value) return
  const stage = stageRef.value
  const { w: nw, h: nh } = dims()
  const sw = stage.clientWidth
  const sh = stage.clientHeight
  const scale = Math.min(sw / nw, sh / nh, 1)
  const w = nw * scale
  const h = nh * scale
  imgRect.x = (sw - w) / 2
  imgRect.y = (sh - h) / 2
  imgRect.w = w
  imgRect.h = h
  // 自由比例：初始选区取居中的 90%，保留原图宽高比，不强制 1:1
  const w90 = w * 0.9
  const h90 = h * 0.9
  crop.w = w90
  crop.h = h90
  crop.x = imgRect.x + (w - w90) / 2
  crop.y = imgRect.y + (h - h90) / 2
}

async function rotate(dir: 1 | -1) {
  if (!drawSource || processing.value) return
  processing.value = true
  try {
    const { w, h } = dims()
    // 限最长边 3200，控制旋转编码耗时
    const cap = Math.min(1, 3200 / Math.max(w, h))
    const cw = Math.max(1, Math.round(w * cap))
    const ch = Math.max(1, Math.round(h * cap))
    const canvas = document.createElement('canvas')
    canvas.width = ch
    canvas.height = cw
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.translate(canvas.width / 2, canvas.height / 2)
    ctx.rotate((dir * Math.PI) / 2)
    ctx.drawImage(drawSource, -cw / 2, -ch / 2, cw, ch)
    const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, 'image/jpeg', 0.92))
    if (!blob) return
    if (objectUrl) URL.revokeObjectURL(objectUrl)
    objectUrl = URL.createObjectURL(blob)
    imgUrl.value = objectUrl
    await sourceFromBlob(blob)
    await applySource()
  } finally {
    processing.value = false
  }
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
  const maxX = imgRect.x + imgRect.w
  const maxY = imgRect.y + imgRect.h
  if (dragMode === 'move') {
    crop.x = clamp(startCrop.x + dx, imgRect.x, maxX - crop.w)
    crop.y = clamp(startCrop.y + dy, imgRect.y, maxY - crop.h)
    return
  }
  // 自由比例：按手柄方向分别调整宽高，以对边为锚点
  const dw = dragMode.includes('e') ? dx : dragMode.includes('w') ? -dx : 0
  const dh = dragMode.includes('s') ? dy : dragMode.includes('n') ? -dy : 0
  let w = startCrop.w + dw
  let h = startCrop.h + dh
  const maxW = dragMode.includes('w')
    ? startCrop.x + startCrop.w - imgRect.x
    : maxX - startCrop.x
  const maxH = dragMode.includes('n')
    ? startCrop.y + startCrop.h - imgRect.y
    : maxY - startCrop.y
  w = clamp(w, Math.min(MIN, maxW), Math.max(MIN, maxW))
  h = clamp(h, Math.min(MIN, maxH), Math.max(MIN, maxH))
  const x = dragMode.includes('w') ? startCrop.x + startCrop.w - w : startCrop.x
  const y = dragMode.includes('n') ? startCrop.y + startCrop.h - h : startCrop.y
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
  if (!drawSource || processing.value) return
  processing.value = true
  try {
    const { w: nw, h: nh } = dims()
    const sx = (crop.x - imgRect.x) / imgRect.w * nw
    const sy = (crop.y - imgRect.y) / imgRect.h * nh
    const sw = crop.w / imgRect.w * nw
    const sh = crop.h / imgRect.h * nh
    // 输出限最长边 1600px：唯一一次编码，大图等比缩小
    const MAX = 1600
    const scale = Math.min(1, MAX / Math.max(sw, sh))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(sw * scale))
    canvas.height = Math.max(1, Math.round(sh * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(drawSource, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.85))
    if (!blob) return
    emit('confirm', new File([blob], filename(), { type: 'image/jpeg' }))
  } finally {
    processing.value = false
  }
}

async function loadFile(file: File) {
  if (objectUrl) URL.revokeObjectURL(objectUrl)
  objectUrl = URL.createObjectURL(file)
  imgUrl.value = objectUrl
  drawSource = null
  await sourceFromBlob(file)
  await applySource()
}

onMounted(() => { void loadFile(props.file) })

// 队列里切到下一张图时 props.file 会变，组件不重挂载，需要手动重新加载
watch(() => props.file, (f) => { void loadFile(f) })

onBeforeUnmount(() => {
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
  window.removeEventListener('pointercancel', onPointerUp)
  if (objectUrl) URL.revokeObjectURL(objectUrl)
})
</script>

<template>
  <div v-dialog="() => emit('cancel')" aria-label="裁剪图片" class="modal-backdrop crop-backdrop" @click.self="emit('cancel')">
    <div class="modal crop-modal">
      <div class="modal-head">
        <div><p class="eyebrow">CROP</p><h3>裁剪封面</h3></div>
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
        <button class="primary-btn" :disabled="processing">{{ processing ? "处理中…" : "裁剪完成" }}</button>
      </div>
    </div>
  </div>
</template>
