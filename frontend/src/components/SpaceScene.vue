<script setup lang="ts">
import { onBeforeUnmount, watch } from 'vue'
import { useLoop, useTresContext } from '@tresjs/core'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { SpaceBox } from '../types'

const props = defineProps<{
  boxes: SpaceBox[]
  room: number
  showLabels: boolean
  focus: { x: number; z: number; nonce: number }
}>()

const emit = defineEmits<{
  (e: 'select', id: number): void
  (e: 'hover', id: number | null): void
}>()

const { camera, renderer } = useTresContext()
const { onBeforeRender } = useLoop()

const NORMAL = new THREE.Color('#b4c6b9')
const MATCH = new THREE.Color('#d9a03c')
const ACTIVE = new THREE.Color('#27614d')

function colorOf(box: SpaceBox): THREE.Color {
  if (box.selected) return ACTIVE
  if (box.highlighted) return MATCH
  return NORMAL
}

// ---- 桌面标签（CanvasTexture 精灵，避免引入额外字体库）----
interface LabelInfo { texture: THREE.CanvasTexture; w: number; h: number }
const labelCache = new Map<string, LabelInfo>()
const LABEL_HEIGHT = 1.4

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
  const info: LabelInfo = { texture, w: LABEL_HEIGHT * (width / height), h: LABEL_HEIGHT }
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

onBeforeRender(() => {
  if (disposed) return
  const el = renderer.instance?.domElement as HTMLCanvasElement | undefined
  const cam = camera.activeCamera.value as THREE.Camera | undefined
  if (!el || !cam) return
  if (!controls || boundCamera !== cam) {
    controls?.dispose()
    controls = new OrbitControls(cam as THREE.PerspectiveCamera, el)
    controls.enableDamping = true
    controls.dampingFactor = 0.09
    controls.minDistance = 3
    controls.maxDistance = 70
    controls.maxPolarAngle = Math.PI / 2.06
    controls.minPolarAngle = 0.15
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
  disposed = true
  controls?.dispose()
  controls = null
  boundCamera = null
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

  <template v-for="box in boxes" :key="box.id">
    <TresMesh
      :position="[box.x, box.y + box.h / 2, box.z]"
      @click="emit('select', box.id)"
      @pointer-enter="emit('hover', box.id)"
      @pointer-leave="emit('hover', null)"
    >
      <TresBoxGeometry :args="[box.w, box.h, box.d]" />
      <TresMeshStandardMaterial
        :color="colorOf(box)"
        :emissive="box.selected ? '#27614d' : '#000000'"
        :emissive-intensity="box.selected ? 0.3 : 0"
        :roughness="0.78"
        :metalness="0.04"
      />
    </TresMesh>
    <TresMesh
      v-if="box.selected || box.highlighted"
      :position="[box.x, box.y + box.h / 2, box.z]"
      :scale="[1.07, 1.07, 1.07]"
    >
      <TresBoxGeometry :args="[box.w, box.h, box.d]" />
      <TresMeshBasicMaterial
        :color="box.selected ? '#27614d' : '#d9a03c'"
        :transparent="true"
        :opacity="0.26"
        :depth-write="false"
      />
    </TresMesh>
  </template>

  <template v-for="box in boxes" :key="'label-' + box.id">
    <TresSprite
      v-if="labelVisible(box)"
      :position="[box.x, box.y + box.h + 0.9, box.z]"
      :scale="[labelInfo(box.name).w, labelInfo(box.name).h, 1]"
    >
      <TresSpriteMaterial :map="labelInfo(box.name).texture" :transparent="true" :depth-write="false" />
    </TresSprite>
  </template>
</template>
