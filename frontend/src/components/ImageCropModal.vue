<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { fitRect, rotatedSize, stageRectToImage, unrotateRect } from '../utils/cropMath'

const props = defineProps<{ file: File }>()
const emit = defineEmits<{ confirm: [File]; skip: []; cancel: [] }>()

const stageRef = ref<HTMLDivElement | null>(null)
const imgUrl = ref('')
const processing = ref(false)
// 解码/出预览期间给个明确的「在干活」提示，避免用户以为卡死
const decoding = ref(true)
// 顺时针 90° 的次数。旋转只改显示和最终编码，不重新编码原图
const rotation = ref(0)

// 图片在裁剪区内的显示区域（stage 坐标，旋转后）
const imgRect = reactive({ x: 0, y: 0, w: 0, h: 0 })
// 选区（stage 坐标）
const crop = reactive({ x: 0, y: 0, w: 0, h: 0 })

// 绘制源：ImageBitmap（createImageBitmap 原生纠正 EXIF），保留原分辨率用于出图
let drawSource: ImageBitmap | HTMLImageElement | null = null
let previewUrl: string | null = null
let loadToken = 0
let dragging = false
let dragMode = 'move'
let startX = 0
let startY = 0
let startCrop = { x: 0, y: 0, w: 0, h: 0 }

const MIN = 24
// 预览图长边：<img> 只解码这么大，不再把 1200 万像素原图整张解码一次
const PREVIEW_MAX = 1280
// 出图长边
const OUTPUT_MAX = 1600

function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)) }

/** 旋转后的像素尺寸 */
function dims(): { w: number; h: number } {
  if (!drawSource) return { w: 1, h: 1 }
  return rotatedSize(drawSource.width, drawSource.height, rotation.value)
}

function releaseSource() {
  const src = drawSource
  drawSource = null
  if (src && typeof (src as ImageBitmap).close === 'function') {
    try { (src as ImageBitmap).close() } catch { /* ignore */ }
  }
}

function releasePreview() {
  if (previewUrl) URL.revokeObjectURL(previewUrl)
  previewUrl = null
}

/** 解码成 ImageBitmap；老内核不支持时回退 <img> */
async function decode(blob: Blob): Promise<ImageBitmap | HTMLImageElement> {
  try {
    // imageOrientation: 让内核直接按 EXIF 输出正确朝向，省掉一次整图重编码
    return await createImageBitmap(blob, { imageOrientation: 'from-image' })
  } catch { /* 回退 */ }
  const url = URL.createObjectURL(blob)
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image()
      image.onload = () => resolve(image)
      image.onerror = () => reject(new Error('图片解码失败'))
      image.src = url
    })
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** 用已解码的位图缩出一张预览图，供 <img> 显示（避免二次整图解码） */
async function makePreview(src: ImageBitmap | HTMLImageElement, fallback: Blob): Promise<string> {
  const scale = Math.min(1, PREVIEW_MAX / Math.max(src.width, src.height))
  const cw = Math.max(1, Math.round(src.width * scale))
  const ch = Math.max(1, Math.round(src.height * scale))
  try {
    const canvas = document.createElement('canvas')
    canvas.width = cw
    canvas.height = ch
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('no 2d context')
    ctx.imageSmoothingQuality = 'medium'
    ctx.drawImage(src, 0, 0, cw, ch)
    const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, 'image/jpeg', 0.86))
    if (!blob) throw new Error('preview encode failed')
    return URL.createObjectURL(blob)
  } catch {
    return URL.createObjectURL(fallback)
  }
}

async function applySource(): Promise<void> {
  if (!drawSource || !stageRef.value) return
  const stage = stageRef.value
  // 首帧可能还没布局完成，等一帧再量
  if (!stage.clientWidth || !stage.clientHeight) {
    await new Promise<void>(r => requestAnimationFrame(() => r()))
  }
  const { w: nw, h: nh } = dims()
  const fitted = fitRect(stage.clientWidth, stage.clientHeight, nw, nh)
  imgRect.x = fitted.x
  imgRect.y = fitted.y
  imgRect.w = fitted.w
  imgRect.h = fitted.h
  // 自由比例：初始选区取居中的 90%，保留原图宽高比，不强制 1:1
  const w90 = imgRect.w * 0.9
  const h90 = imgRect.h * 0.9
  crop.w = w90
  crop.h = h90
  crop.x = imgRect.x + (imgRect.w - w90) / 2
  crop.y = imgRect.y + (imgRect.h - h90) / 2
}

/** <img> 的定位：奇数次旋转时元素盒宽高互换，靠 transform 转回来正好铺满 imgRect */
const previewStyle = computed(() => {
  const r = rotation.value % 4
  const odd = r % 2 === 1
  const dw = odd ? imgRect.h : imgRect.w
  const dh = odd ? imgRect.w : imgRect.h
  const cx = imgRect.x + imgRect.w / 2
  const cy = imgRect.y + imgRect.h / 2
  return {
    left: `${cx - dw / 2}px`,
    top: `${cy - dh / 2}px`,
    width: `${dw}px`,
    height: `${dh}px`,
    transform: r ? `rotate(${r * 90}deg)` : 'none',
  }
})

/** 旋转：只改状态 + 重排显示，不做任何解码/编码，点下去立刻响应 */
function rotate(dir: 1 | -1) {
  if (!drawSource) return
  rotation.value = (rotation.value + (dir === 1 ? 1 : 3)) % 4
  void applySource()
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
    // 用户看到的选区（旋转后坐标系）→ 原图像素
    const viewed = stageRectToImage(crop, imgRect, nw, nh)
    const src = unrotateRect(viewed, rotation.value, drawSource.width, drawSource.height)
    if (src.w < 1 || src.h < 1) return

    const outW = Math.max(1, Math.round(viewed.w))
    const outH = Math.max(1, Math.round(viewed.h))
    const scale = Math.min(1, OUTPUT_MAX / Math.max(outW, outH))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(outW * scale))
    canvas.height = Math.max(1, Math.round(outH * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.imageSmoothingQuality = 'high'

    const r = rotation.value % 4
    if (r === 0) {
      ctx.drawImage(drawSource, src.x, src.y, src.w, src.h, 0, 0, canvas.width, canvas.height)
    } else {
      // 一次带变换的绘制：把原图那块区域按显示朝向转到画布上
      ctx.translate(canvas.width / 2, canvas.height / 2)
      ctx.rotate((r * Math.PI) / 2)
      const dw = src.w * scale
      const dh = src.h * scale
      ctx.drawImage(drawSource, src.x, src.y, src.w, src.h, -dw / 2, -dh / 2, dw, dh)
    }

    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.85))
    if (!blob) return
    emit('confirm', new File([blob], filename(), { type: 'image/jpeg' }))
  } finally {
    processing.value = false
  }
}

async function loadFile(file: File) {
  const token = ++loadToken
  decoding.value = true
  rotation.value = 0
  let src: ImageBitmap | HTMLImageElement | null = null
  try {
    src = await decode(file)
    if (token !== loadToken) { releaseBitmap(src); return }
    releaseSource()
    drawSource = src
    await applySource()
    const url = await makePreview(src, file)
    if (token !== loadToken) { URL.revokeObjectURL(url); return }
    releasePreview()
    previewUrl = url
    imgUrl.value = url
  } catch {
    if (token === loadToken) imgUrl.value = ''
  } finally {
    if (token === loadToken) decoding.value = false
  }
}

function releaseBitmap(src: ImageBitmap | HTMLImageElement) {
  if (typeof (src as ImageBitmap).close === 'function') {
    try { (src as ImageBitmap).close() } catch { /* ignore */ }
  }
}

onMounted(() => { void loadFile(props.file) })

// 队列里切到下一张图时 props.file 会变，组件不重挂载，需要手动重新加载
watch(() => props.file, (f) => { if (f) void loadFile(f) })

onBeforeUnmount(() => {
  loadToken++
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
  window.removeEventListener('pointercancel', onPointerUp)
  releaseSource()
  releasePreview()
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
        <img v-if="imgUrl" class="crop-img" :src="imgUrl" alt="" :style="previewStyle" />
        <p v-if="decoding" class="crop-hint">正在准备图片…</p>
        <div v-else-if="imgRect.w" class="crop-box" :style="{ left: crop.x + 'px', top: crop.y + 'px', width: crop.w + 'px', height: crop.h + 'px' }"
          @pointerdown.prevent="onPointerDown($event, 'move')">
          <span v-for="h in ['nw','n','ne','e','se','s','sw','w']" :key="h" class="crop-handle" :class="'h-' + h"
            @pointerdown.prevent.stop="onPointerDown($event, h)"></span>
        </div>
      </div>

      <div class="crop-toolbar">
        <button type="button" class="outline-btn compact" :disabled="!drawSource || processing" @click="rotate(-1)">⟲ 左转</button>
        <button type="button" class="outline-btn compact" :disabled="!drawSource || processing" @click="rotate(1)">⟳ 右转</button>
        <span class="grow"></span>
        <button type="button" class="outline-btn" @click="emit('skip')">用原图</button>
        <button class="primary-btn" :disabled="processing || decoding" @click="confirm">{{ processing ? "处理中…" : "裁剪完成" }}</button>
      </div>
    </div>
  </div>
</template>
