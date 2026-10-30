<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useLoop, useTresContext } from '@tresjs/core'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { attachmentUrl } from '../api'
import type { SpaceBox } from '../types'

const props = defineProps<{
  boxes: SpaceBox[]
  room: number
  showLabels: boolean
  focus: { x: number; z: number; nonce: number }
  selectedId: number | null
  /** 是否给箱子贴封面图片；关闭时全部以白模纯色显示。 */
  showCovers: boolean
  /** 名字标签大小倍数（基准再乘 5，默认 1）。 */
  labelScale: number
  /** 是否启用实体碰撞：重叠时不允许移动/缩放。 */
  collisionEnabled: boolean
}>()

const emit = defineEmits<{
  (e: 'select', id: number): void
  (e: 'hover', id: number | null): void
  (e: 'transform', value: { id: number; x: number; z: number; w: number; d: number }): void
}>()

const { camera, renderer } = useTresContext()
const { onBeforeRender } = useLoop()

const MIN_SIZE = 0.6
const MAX_SIZE = 12
const DEFAULT_CAMERA = new THREE.Vector3(14, 13, 18)

// 白模（纯色）默认色：近白的中性灰，靠灯光阴影区分体面。
const NORMAL = new THREE.Color('#d9ddd8')

// 高亮一律用「外框描边」（Minecraft 式），不给箱体染色，避免封面贴图盖掉颜色。
// 优先级：选中 > 搜索命中 > 悬停；悬停不再用绿色。
const OUTLINE_HOVER = '#ffd23f'
const OUTLINE_MATCH = '#ff8a1f'
const OUTLINE_SELECTED = '#2fbf71'
const OUTLINE_MIN_PAD = 0.12
const OUTLINE_PAD_RATIO = 0.05

/** 外框边长：比箱体每边各外扩一圈，小箱子保证最小厚度。 */
function outlineSize(value: number): number {
  return value + Math.max(OUTLINE_MIN_PAD, value * OUTLINE_PAD_RATIO)
}
function outlineVisible(box: SpaceBox): boolean {
  return box.selected || box.highlighted || !!box.hovered
}
function outlineColor(box: SpaceBox): string {
  if (box.selected) return OUTLINE_SELECTED
  if (box.highlighted) return OUTLINE_MATCH
  return OUTLINE_HOVER
}

// ---- 封面贴图：按附件 id 缓存，加载完成后直接写入材质 ----
// 注意：异步加载的贴图不能只靠 TresJS 的 :map 响应式更新（材质已存在时不会被重新 patch），
// 因此改为通过材质 ref 手动设置 map 并 needsUpdate。
const textureCache = new Map<number, THREE.Texture>()
const pendingTextures = new Set<number>()
const textureLoader = new THREE.TextureLoader()
const materials = new Map<number, THREE.MeshStandardMaterial>()

const WHITE = new THREE.Color('#ffffff')
const BLACK = new THREE.Color('#000000')

function registerMaterial(id: number, el: unknown) {
  if (el instanceof THREE.MeshStandardMaterial) {
    materials.set(id, el)
    const box = props.boxes.find((b) => b.id === id)
    if (box) applyBoxStyle(box)
  } else {
    materials.delete(id)
  }
}

function desiredTexture(box: SpaceBox): THREE.Texture | null {
  if (!props.showCovers || box.coverId == null) return null
  return textureCache.get(box.coverId) ?? null
}

function applyBoxStyle(box: SpaceBox) {
  const material = materials.get(box.id)
  if (!material) return
  const texture = desiredTexture(box)
  if (material.map !== texture) {
    material.map = texture
    material.needsUpdate = true
  }
  // 箱体本身不随高亮/选中变色：贴图时纯白（保持原图）、白模时中性灰。
  // 高亮统一由外侧描边表达，避免被封面图盖住看不见。
  material.color.copy(texture ? WHITE : NORMAL)
  material.emissive.copy(BLACK)
  material.emissiveIntensity = 0
  material.roughness = texture ? 0.55 : 0.78
  material.metalness = 0.04
}

function ensureCoverTexture(coverId: number) {
  if (textureCache.has(coverId) || pendingTextures.has(coverId)) return
  pendingTextures.add(coverId)
  textureLoader.load(
    attachmentUrl(coverId),
    (texture) => {
      texture.colorSpace = THREE.SRGBColorSpace
      texture.anisotropy = 4
      textureCache.set(coverId, texture)
      pendingTextures.delete(coverId)
      syncBoxStyles()
    },
    undefined,
    () => { pendingTextures.delete(coverId) },
  )
}

/** 开始加载所需贴图，并把当前样式（贴图/颜色/高亮）同步到已存在的材质上。 */
function syncBoxStyles() {
  if (props.showCovers) {
    for (const box of props.boxes) if (box.coverId != null) ensureCoverTexture(box.coverId)
  }
  for (const box of props.boxes) applyBoxStyle(box)
}

watch([() => props.boxes, () => props.showCovers], syncBoxStyles)

// ---- 桌面标签（CanvasTexture 精灵，避免引入额外字体库）----
interface LabelInfo { texture: THREE.CanvasTexture; ratio: number }
const labelCache = new Map<string, LabelInfo>()
// 标签基准高度：相较原始 1.4 缩小 5 倍，再由 labelScale 调节。
const BASE_LABEL_HEIGHT = 0.28
const labelHeight = computed(() => BASE_LABEL_HEIGHT * props.labelScale)

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + r)
  ctx.lineTo(x + w, y + h - r)
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  ctx.lineTo(x + r, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - r)
  ctx.lineTo(x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
}

function labelInfo(name: string): LabelInfo {
  const key = name || '未命名'
  const cached = labelCache.get(key)
  if (cached) return cached
  const font = '600 40px "Microsoft YaHei", "PingFang SC", sans-serif'
  const padX = 20
  const padY = 12
  const probe = document.createElement('canvas').getContext('2d')
  const text = key.length > 10 ? key.slice(0, 10) + '…' : key
  probe!.font = font
  const width = Math.ceil(probe!.measureText(text).width) + padX * 2
  const height = 64 + padY * 2
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')!
  roundRect(ctx, 0, 0, width, height, 16)
  ctx.fillStyle = 'rgba(26, 45, 37, 0.82)'
  ctx.fill()
  ctx.font = font
  ctx.fillStyle = '#ffffff'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, padX, height / 2)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  const info: LabelInfo = { texture, ratio: width / height }
  labelCache.set(key, info)
  return info
}

function labelVisible(box: SpaceBox): boolean {
  return props.showLabels || box.selected || box.highlighted
}

// ---- 轨道相机 ----
let controls: OrbitControls | null = null
let boundCamera: THREE.Camera | null = null
let flyTo: { position: THREE.Vector3; target: THREE.Vector3 } | null = null
let desiredFocus: { x: number; z: number } | null = null
let disposed = false

watch(
  () => props.focus.nonce,
  () => {
    desiredFocus = { x: props.focus.x, z: props.focus.z }
  },
)

// ---- Blender 式变换（G / S / R 的临时预览，确认后才写回）----
const override = ref<{ id: number; x: number; z: number; w: number; d: number } | null>(null)
const modal = ref<'grab' | 'scale' | 'rotate' | null>(null)
const rendered = computed<SpaceBox[]>(() => props.boxes.map((box) => {
  const ghost = override.value
  return ghost && ghost.id === box.id ? { ...box, x: ghost.x, z: ghost.z, w: ghost.w, d: ghost.d } : box
}))

let canvasEl: HTMLCanvasElement | null = null
let lastPointer = { x: 0, y: 0 }
let origin: SpaceBox | null = null
let base = { x: 0, z: 0, w: 1, d: 1 }
let floorAnchor: { x: number; z: number } | null = null
let scaleStart = 0
let rotSteps = 0
let suppressUntil = 0

const raycaster = new THREE.Raycaster()
const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
const ndc = new THREE.Vector2()
const hitPoint = new THREE.Vector3()

function clampSnap(value: number, min: number, max: number): number {
  return Math.round(Math.min(max, Math.max(min, value)) * 2) / 2
}
function clampSize(value: number): number {
  return Math.round(Math.min(MAX_SIZE, Math.max(MIN_SIZE, value)) * 2) / 2
}

/** 平面（XZ 投影）重叠判定：与其它箱子底面矩形相交即视为冲突。 */
function collides(candidate: { x: number; z: number; w: number; d: number }, ignoreId: number): boolean {
  if (!props.collisionEnabled) return false
  const eps = 0.05
  for (const b of props.boxes) {
    if (b.id === ignoreId) continue
    if (Math.abs(candidate.x - b.x) < (candidate.w + b.w) / 2 - eps &&
        Math.abs(candidate.z - b.z) < (candidate.d + b.d) / 2 - eps) return true
  }
  return false
}

function pointerToFloor(point: { x: number; y: number }): { x: number; z: number } | null {
  const el = canvasEl
  const cam = camera.activeCamera.value as THREE.PerspectiveCamera | undefined
  if (!el || !cam) return null
  const rect = el.getBoundingClientRect()
  if (!rect.width || !rect.height) return null
  ndc.set(((point.x - rect.left) / rect.width) * 2 - 1, -((point.y - rect.top) / rect.height) * 2 + 1)
  raycaster.setFromCamera(ndc, cam)
  const hit = raycaster.ray.intersectPlane(floorPlane, hitPoint)
  return hit ? { x: hitPoint.x, z: hitPoint.z } : null
}

function selectedBox(): SpaceBox | null {
  return props.boxes.find((box) => box.id === props.selectedId) ?? null
}

function beginModal(kind: 'grab' | 'scale' | 'rotate', box: SpaceBox) {
  origin = box
  base = { x: box.x, z: box.z, w: box.w, d: box.d }
  floorAnchor = null
  scaleStart = 0
  rotSteps = 0
  override.value = { id: box.id, x: box.x, z: box.z, w: box.w, d: box.d }
  modal.value = kind
  if (controls) controls.enabled = false
}
function startGrab() { const box = selectedBox(); if (box) beginModal('grab', box) }
function startScale() { const box = selectedBox(); if (box) beginModal('scale', box) }
function startRotate() { const box = selectedBox(); if (box) beginModal('rotate', box) }

function rotateStep() {
  if (!origin) return
  const swapped = (rotSteps + 1) % 2 === 1
  const next = {
    id: origin.id,
    x: base.x,
    z: base.z,
    w: swapped ? base.d : base.w,
    d: swapped ? base.w : base.d,
  }
  if (collides(next, origin.id)) return
  rotSteps += 1
  override.value = next
}

function endModal() {
  modal.value = null
  override.value = null
  origin = null
  floorAnchor = null
  scaleStart = 0
  rotSteps = 0
  if (controls) controls.enabled = true
}
function commitTransform() {
  const ghost = override.value
  const box = origin
  if (!ghost || !box) { endModal(); return }
  suppressUntil = performance.now() + 350
  emit('transform', { id: box.id, x: ghost.x, z: ghost.z, w: ghost.w, d: ghost.d })
  endModal()
}
function cancelTransform() { endModal() }

function updateGrab(floor: { x: number; z: number }) {
  if (!origin) return
  if (!floorAnchor) floorAnchor = floor
  const half = props.room / 2 - 0.5
  const x = clampSnap(base.x + (floor.x - floorAnchor.x), -half, half)
  const z = clampSnap(base.z + (floor.z - floorAnchor.z), -half, half)
  // 实体碰撞：目标位置与其它箱子重叠时保持上一个合法位置（不允许移动过去）
  if (collides({ x, z, w: base.w, d: base.d }, origin.id)) return
  override.value = { id: origin.id, x, z, w: base.w, d: base.d }
}
function updateScale(floor: { x: number; z: number }) {
  if (!origin) return
  if (!floorAnchor) {
    floorAnchor = floor
    scaleStart = Math.hypot(floor.x - base.x, floor.z - base.z)
    return
  }
  const distance = Math.hypot(floor.x - base.x, floor.z - base.z)
  const factor = scaleStart > 0.3 ? Math.max(0.15, distance / scaleStart) : 1
  const w = clampSize(base.w * factor)
  const d = clampSize(base.d * factor)
  if (collides({ x: base.x, z: base.z, w, d }, origin.id)) return
  override.value = { id: origin.id, x: base.x, z: base.z, w, d }
}

function onCanvasMove(event: PointerEvent) {
  lastPointer.x = event.clientX
  lastPointer.y = event.clientY
  if (!modal.value) return
  const floor = pointerToFloor(lastPointer)
  if (!floor) return
  if (modal.value === 'grab') updateGrab(floor)
  else if (modal.value === 'scale') updateScale(floor)
}

function onBoxClick(id: number) {
  if (performance.now() < suppressUntil) return
  emit('select', id)
}

// ---- 相机视角（小键盘 1/3/7/0、Home、F）----
function setView(kind: 'front' | 'right' | 'top' | 'reset') {
  if (kind === 'reset') {
    flyTo = { position: DEFAULT_CAMERA.clone(), target: new THREE.Vector3(0, 1, 0) }
    return
  }
  const span = props.room * 1.5
  if (kind === 'front') flyTo = { position: new THREE.Vector3(0, props.room * 0.75, span), target: new THREE.Vector3(0, 1, 0) }
  else if (kind === 'right') flyTo = { position: new THREE.Vector3(span, props.room * 0.75, 0), target: new THREE.Vector3(0, 1, 0) }
  else flyTo = { position: new THREE.Vector3(0, props.room * 1.6, 0.001), target: new THREE.Vector3(0, 0, 0) }
}
function frameAll() {
  const cam = camera.activeCamera.value as THREE.PerspectiveCamera | undefined
  if (!cam || !controls) return
  const dir = new THREE.Vector3(cam.position.x - controls.target.x, 0, cam.position.z - controls.target.z)
  if (dir.lengthSq() < 0.001) dir.set(1, 0, 1)
  dir.setLength(props.room * 1.3)
  flyTo = { position: new THREE.Vector3(dir.x, props.room * 0.95, dir.z), target: new THREE.Vector3(0, 1, 0) }
}
function frameSelected() {
  const box = selectedBox()
  const cam = camera.activeCamera.value as THREE.PerspectiveCamera | undefined
  if (!box || !cam || !controls) return
  const dir = new THREE.Vector3(cam.position.x - box.x, 0, cam.position.z - box.z)
  if (dir.lengthSq() < 0.001) dir.set(1, 0, 1)
  dir.setLength(Math.max(7, box.w + box.d + 4))
  const lift = box.y + box.h + 6
  flyTo = { position: new THREE.Vector3(box.x + dir.x, lift, box.z + dir.z), target: new THREE.Vector3(box.x, box.y + box.h / 2, box.z) }
}

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
}

function onKeyDown(event: KeyboardEvent) {
  if (isTyping(event.target)) return
  if (document.querySelector('.modal-backdrop')) return
  const key = event.key
  if (modal.value) {
    if (key === 'Escape') { event.preventDefault(); cancelTransform(); return }
    if (key === 'Enter') { event.preventDefault(); commitTransform(); return }
    if (modal.value === 'rotate' && (key === 'r' || key === 'R') && !event.repeat) {
      event.preventDefault()
      rotateStep()
    }
    return
  }
  if (event.ctrlKey || event.metaKey || event.altKey) return
  const numpad: Record<string, 'front' | 'right' | 'top' | 'reset'> = {
    Numpad1: 'front', Numpad3: 'right', Numpad7: 'top', Numpad0: 'reset',
  }
  if (event.code in numpad) {
    event.preventDefault()
    setView(numpad[event.code])
    return
  }
  if (event.code === 'NumpadDecimal') { event.preventDefault(); frameSelected(); return }
  switch (key) {
    case 'g': case 'G': event.preventDefault(); startGrab(); return
    case 's': case 'S': event.preventDefault(); startScale(); return
    case 'r': case 'R': event.preventDefault(); startRotate(); return
    case 'f': case 'F': event.preventDefault(); frameSelected(); return
    case 'Home': event.preventDefault(); frameAll(); return
    case '1': event.preventDefault(); setView('front'); return
    case '3': event.preventDefault(); setView('right'); return
    case '7': event.preventDefault(); setView('top'); return
    case '0': event.preventDefault(); setView('reset'); return
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKeyDown)
  syncBoxStyles()
})

onBeforeRender(() => {
  if (disposed) return
  const el = renderer.instance?.domElement as HTMLCanvasElement | undefined
  const cam = camera.activeCamera.value as THREE.Camera | undefined
  if (!el || !cam) return
  if (canvasEl !== el) {
    canvasEl?.removeEventListener('pointermove', onCanvasMove)
    el.addEventListener('pointermove', onCanvasMove)
    canvasEl = el
  }
  if (!controls || boundCamera !== cam) {
    controls?.dispose()
    controls = new OrbitControls(cam as THREE.PerspectiveCamera, el)
    controls.enableDamping = true
    controls.dampingFactor = 0.09
    controls.minDistance = 3
    controls.maxDistance = 70
    controls.maxPolarAngle = Math.PI / 2.06
    controls.minPolarAngle = 0.15
    // Blender 习惯：左键只选中（不转视角），中键旋转，右键平移，滚轮缩放。
    controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.ROTATE, RIGHT: THREE.MOUSE.PAN }
    controls.enabled = !modal.value
    boundCamera = cam
  }
  if (desiredFocus) {
    const target = new THREE.Vector3(desiredFocus.x, 1, desiredFocus.z)
    const direction = new THREE.Vector3(cam.position.x - controls.target.x, 0, cam.position.z - controls.target.z)
    if (direction.lengthSq() < 0.001) direction.set(1, 0, 1)
    direction.setLength(Math.max(6, direction.length()))
    flyTo = { position: target.clone().add(direction).setY(Math.max(6, cam.position.y)), target }
    desiredFocus = null
  }
  if (flyTo) {
    cam.position.lerp(flyTo.position, 0.12)
    controls.target.lerp(flyTo.target, 0.12)
    if (cam.position.distanceTo(flyTo.position) < 0.15) flyTo = null
  }
  controls.update()
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeyDown)
  canvasEl?.removeEventListener('pointermove', onCanvasMove)
  canvasEl = null
  disposed = true
  endModal()
  controls?.dispose()
  controls = null
  boundCamera = null
  textureCache.forEach((tex) => tex.dispose())
  textureCache.clear()
  pendingTextures.clear()
  materials.forEach((mat) => mat.dispose())
  materials.clear()
})
</script>

<template>
  <TresPerspectiveCamera :position="[14, 13, 18]" :fov="42" :near="0.1" :far="200" />
  <TresAmbientLight :intensity="1.1" />
  <TresHemisphereLight :args="['#ffffff', '#9fb4a5', 0.6]" />
  <TresDirectionalLight :position="[10, 18, 8]" :intensity="1.5" />
  <TresDirectionalLight :position="[-12, 10, -9]" :intensity="0.5" />

  <TresMesh :rotation="[-Math.PI / 2, 0, 0]">
    <TresPlaneGeometry :args="[room, room]" />
    <TresMeshStandardMaterial color="#e8ede4" />
  </TresMesh>
  <TresGridHelper :args="[room, room, '#bcc9bd', '#d7e0d5']" :position="[0, 0.01, 0]" />

  <template v-for="box in rendered" :key="box.id">
    <!-- TresJS v5 只认 onPointerenter/onPointerleave（原生事件名，小写 e）；
         写成 @pointer-enter 会落到未知属性赋值路径，触发 Vue 递归更新导致页面卡死 -->
    <TresMesh
      :position="[box.x, box.y + box.h / 2, box.z]"
      @click="onBoxClick(box.id)"
      @pointerenter="emit('hover', box.id)"
      @pointerleave="emit('hover', null)"
    >
      <TresBoxGeometry :args="[box.w, box.h, box.d]" />
      <TresMeshStandardMaterial :ref="(el: unknown) => registerMaterial(box.id, el)" />
    </TresMesh>
    <TresMesh
      v-if="outlineVisible(box)"
      :position="[box.x, box.y + box.h / 2, box.z]"
    >
      <TresBoxGeometry
        :args="[outlineSize(box.w), outlineSize(box.h), outlineSize(box.d)]"
      />
      <TresMeshBasicMaterial :color="outlineColor(box)" :side="THREE.BackSide" />
    </TresMesh>
  </template>

  <template v-for="box in rendered" :key="'label-' + box.id">
    <TresSprite
      v-if="labelVisible(box)"
      :position="[box.x, box.y + box.h + 0.2 + labelHeight / 2, box.z]"
      :scale="[labelInfo(box.name).ratio * labelHeight, labelHeight, 1]"
    >
      <TresSpriteMaterial :map="labelInfo(box.name).texture" :transparent="true" :depth-write="false" />
    </TresSprite>
  </template>
</template>
