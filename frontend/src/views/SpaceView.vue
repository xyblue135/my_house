<script setup lang="ts">
import { computed, onActivated, onDeactivated, reactive, ref, watch } from 'vue'
import { TresCanvas } from '@tresjs/core'
import SpaceScene from '../components/SpaceScene.vue'
import AppIcon from '../components/AppIcon.vue'
import { api } from '../api'
import { useAppStore } from '../store'
import { useAppBootstrap } from '../composables/useAppBootstrap'
import { useToast } from '../composables/useToast'
import { features } from '../composables/useFeatureToggles'
import { useVoiceInput } from '../composables/useVoiceInput'
import type { Container, Item, SpaceBox } from '../types'

// 房间 16x16 格；1 格 ≈ 50cm。
const ROOM = 16
const MIN_SIZE = 0.6
const MAX_SIZE = 12

const store = useAppStore()
const { refreshData } = useAppBootstrap()
const { toast } = useToast()
// 语音找箱子：说话 → 填入搜索 → 自动高亮定位（仅安卓 App 显示）
const voice = useVoiceInput()
function onVoice() {
  void voice.toggle({
    partial: (text) => { query.value = text },
    final: (text) => { query.value = text },
    error: (message) => toast(message),
  })
}

const active = ref(true)
onActivated(() => { active.value = true })
onDeactivated(() => { active.value = false })

function num(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}
function clampSize(value: number): number {
  return Math.min(MAX_SIZE, Math.max(MIN_SIZE, value))
}
function round(value: number): number {
  return Math.round(value * 100) / 100
}

const allContainers = computed(() => store.containers)

/** 从未摆放过：x/z 都还是初始 0。这类箱子由前端自动排到空闲位置，不落库。 */
function isPlaced(c: Container): boolean {
  return num(c.pos_x, 0) !== 0 || num(c.pos_z, 0) !== 0
}
const unplaced = computed(() => allContainers.value.filter((c) => !isPlaced(c)))
const placedCount = computed(() => allContainers.value.length - unplaced.value.length)

/** 未摆放箱子的自动排布：从角落按行铺开，尽量不重叠。 */
const autoLayout = computed(() => {
  const positions = new Map<number, { x: number; z: number }>()
  const margin = 1
  const gap = 0.6
  let cursorX = -ROOM / 2 + margin
  let cursorZ = -ROOM / 2 + margin
  let rowDepth = 0
  for (const c of unplaced.value) {
    const w = clampSize(num(c.size_w, 1))
    const d = clampSize(num(c.size_d, 1))
    if (cursorX + w > ROOM / 2 - margin && cursorX > -ROOM / 2 + margin) {
      cursorX = -ROOM / 2 + margin
      cursorZ += rowDepth + gap
      rowDepth = 0
    }
    positions.set(c.id, { x: cursorX + w / 2, z: cursorZ + d / 2 })
    cursorX += w + gap
    rowDepth = Math.max(rowDepth, d)
  }
  return positions
})

const selectedId = ref<number | null>(null)
const hoveredId = ref<number | null>(null)

// ---- 显示选项：名字标签大小、右侧面板显隐 ----
const LABEL_SCALE_KEY = 'myhouse.spaceLabelScale'
const labelScale = ref(Number(localStorage.getItem(LABEL_SCALE_KEY)) || 1)
function changeLabelScale(delta: number) {
  const next = Math.min(4, Math.max(0.4, Math.round((labelScale.value + delta) * 100) / 100))
  labelScale.value = next
  localStorage.setItem(LABEL_SCALE_KEY, String(next))
}
const panelOpen = ref(true)
function toggleCover() {
  features.boxCover = !features.boxCover
}

/** 实体碰撞：目标平面与其它箱子底面矩形相交即冲突。 */
function findCollision(box: { id: number; x: number; z: number; w: number; d: number }): SpaceBox | null {
  if (!features.collision) return null
  const eps = 0.05
  for (const other of displayBoxes.value) {
    if (other.id === box.id) continue
    if (Math.abs(box.x - other.x) < (box.w + other.w) / 2 - eps &&
        Math.abs(box.z - other.z) < (box.d + other.d) / 2 - eps) return other
  }
  return null
}

const displayBoxes = computed<SpaceBox[]>(() =>
  allContainers.value.map((c) => {
    const placed = isPlaced(c)
    const auto = autoLayout.value.get(c.id)
    return {
      id: c.id,
      name: c.name,
      x: placed ? num(c.pos_x, 0) : (auto?.x ?? 0),
      y: placed ? num(c.pos_y, 0) : 0,
      z: placed ? num(c.pos_z, 0) : (auto?.z ?? 0),
      w: clampSize(num(c.size_w, 1)),
      h: clampSize(num(c.size_h, 1)),
      d: clampSize(num(c.size_d, 1)),
      itemCount: c.item_count,
      highlighted: false,
      selected: false,
      coverId: c.cover_attachment_id ?? null,
    }
  }).map((box) => ({
    ...box,
    highlighted: highlightIds.value.has(box.id),
    selected: box.id === selectedId.value,
    hovered: box.id === hoveredId.value,
  })),
)

const selectedBox = computed(() => displayBoxes.value.find((b) => b.id === selectedId.value) ?? null)

// ---- 搜索：命中箱子名，或命中箱内物品 ----
const query = ref('')
const matchItems = ref<Item[]>([])
const searching = ref(false)
const searchError = ref('')

const matchedContainers = computed(() => {
  const keyword = query.value.trim().toLocaleLowerCase()
  if (!keyword) return [] as Container[]
  return allContainers.value.filter((c) =>
    (c.name + ' ' + (c.notes || '')).toLocaleLowerCase().includes(keyword),
  )
})
const itemsByContainer = computed(() => {
  const map = new Map<number, Item[]>()
  for (const item of matchItems.value) {
    const list = map.get(item.container_id) ?? []
    list.push(item)
    map.set(item.container_id, list)
  }
  return map
})
const highlightIds = computed(() => new Set<number>([
  ...matchedContainers.value.map((c) => c.id),
  ...itemsByContainer.value.keys(),
]))
const searchingActive = computed(() => !!query.value.trim())
const highlightCount = computed(() => highlightIds.value.size)

watch(query, (value, _, onCleanup) => {
  const keyword = value.trim()
  matchItems.value = []
  searchError.value = ''
  searching.value = !!keyword
  if (!keyword) return
  const controller = new AbortController()
  const timer = window.setTimeout(async () => {
    try {
      const result = await api<Item[]>('/api/items?q=' + encodeURIComponent(keyword), { signal: controller.signal })
      if (!controller.signal.aborted) matchItems.value = result
    } catch (error) {
      if (!controller.signal.aborted) searchError.value = (error as Error).message
    } finally {
      if (!controller.signal.aborted) searching.value = false
    }
  }, 220)
  onCleanup(() => {
    clearTimeout(timer)
    controller.abort()
  })
})

// ---- 相机定位 ----
const focus = reactive({ x: 0, z: 0, nonce: 0 })
function locate(box: SpaceBox) {
  focus.x = box.x
  focus.z = box.z
  focus.nonce++
}
function selectBox(id: number, moveCamera: boolean) {
  selectedId.value = id
  const box = displayBoxes.value.find((b) => b.id === id)
  if (box && moveCamera) locate(box)
}
function onSceneSelect(id: number) {
  selectBox(id, false)
}
function onSceneHover(id: number | null) {
  hoveredId.value = id
}

/** G/S/R 模态变换确认后写回：只更新平面位置与底面尺寸，不动物品高度。 */
async function onTransform(value: { id: number; x: number; z: number; w: number; d: number }) {
  if (saving.value) return
  const clash = findCollision({ id: value.id, x: value.x, z: value.z, w: value.w, d: value.d })
  if (clash) {
    toast(`与「${clash.name}」位置冲突，未保存`)
    return
  }
  saving.value = true
  try {
    await api(`/api/containers/${value.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        pos_x: round(value.x),
        pos_z: round(value.z),
        size_w: clampSize(value.w),
        size_d: clampSize(value.d),
      }),
    })
    await refreshData()
    toast('摆位已保存')
  } catch (error) {
    toast((error as Error).message)
  } finally {
    saving.value = false
  }
}

// ---- 编辑 ----
const form = reactive({ x: 0, y: 0, z: 0, w: 1, h: 1, d: 1 })
const saving = ref(false)
const arranging = ref(false)

watch(selectedBox, (box) => {
  if (!box) return
  form.x = round(box.x)
  form.y = round(box.y)
  form.z = round(box.z)
  form.w = round(box.w)
  form.h = round(box.h)
  form.d = round(box.d)
})

async function saveBox() {
  const box = selectedBox.value
  if (!box || saving.value) return
  const clash = findCollision({
    id: box.id,
    x: round(form.x),
    z: round(form.z),
    w: clampSize(form.w),
    d: clampSize(form.d),
  })
  if (clash) {
    toast(`与「${clash.name}」位置冲突，未保存`)
    return
  }
  saving.value = true
  try {
    await api(`/api/containers/${box.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        pos_x: round(form.x),
        pos_y: Math.max(0, round(form.y)),
        pos_z: round(form.z),
        size_w: clampSize(form.w),
        size_h: clampSize(form.h),
        size_d: clampSize(form.d),
      }),
    })
    await refreshData()
    toast('摆位已保存')
  } catch (error) {
    toast((error as Error).message)
  } finally {
    saving.value = false
  }
}

async function arrangeUnplaced() {
  if (arranging.value) return
  const targets = unplaced.value
    .map((c) => ({ id: c.id, pos: autoLayout.value.get(c.id) }))
    .filter((t): t is { id: number; pos: { x: number; z: number } } => !!t.pos)
  if (!targets.length) {
    toast('所有箱子都已摆放')
    return
  }
  arranging.value = true
  try {
    for (const target of targets) {
      await api(`/api/containers/${target.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ pos_x: target.pos.x, pos_y: 0, pos_z: target.pos.z }),
      })
    }
    await refreshData()
    toast(`已摆放 ${targets.length} 个箱子`)
  } catch (error) {
    toast((error as Error).message)
  } finally {
    arranging.value = false
  }
}

const showLabels = computed(() => displayBoxes.value.length <= 24)
</script>

<template>
  <section class="view space-view active">
    <div class="page-heading">
      <div>
        <p class="eyebrow">把收纳摆进房间</p>
        <h1>房间视图</h1>
        <p class="page-description">
          {{ allContainers.length }} 个箱子，已摆放 {{ placedCount }} 个。1 格约 50 厘米。
        </p>
      </div>
    </div>

    <div class="space-layout">
      <div class="space-stage" v-if="active">
        <TresCanvas :clear-color="'#e9efe7'" :antialias="true" :dpr="[1, 1.8]">
          <SpaceScene
            :boxes="displayBoxes"
            :room="ROOM"
            :show-labels="showLabels"
            :focus="focus"
            :selected-id="selectedId"
            :show-covers="features.boxCover"
            :label-scale="labelScale"
            :collision-enabled="features.collision"
            @select="onSceneSelect"
            @hover="onSceneHover"
            @transform="onTransform"
          />
        </TresCanvas>
        <button
          class="space-panel-toggle"
          :aria-pressed="panelOpen"
          :title="panelOpen ? '隐藏侧边栏' : '显示侧边栏'"
          @click="panelOpen = !panelOpen"
        >
          <AppIcon name="grid" :size="17" />
          <span>{{ panelOpen ? '隐藏侧边栏' : '显示侧边栏' }}</span>
        </button>
        <div class="space-overlay">
          <div class="space-search">
            <AppIcon name="search" :size="18" />
            <input v-model="query" type="search" placeholder="找物品，高亮它在房间里的位置" aria-label="在房间视图搜索" />
            <button
              v-if="voice.supported"
              type="button"
              class="mic-btn"
              :class="{ listening: voice.listening.value }"
              :aria-label="voice.listening.value ? '停止语音输入' : '语音输入'"
              @click.prevent="onVoice"
            >
              <AppIcon name="mic" :size="17" />
            </button>
            <button v-if="query" type="button" aria-label="清空搜索" @click="query = ''">
              <AppIcon name="close" :size="16" />
            </button>
          </div>
          <div class="space-tools">
            <div class="space-label-size" role="group" aria-label="调节箱子名字大小">
              <span>名字大小</span>
              <button type="button" aria-label="缩小名字" @click="changeLabelScale(-0.25)">A−</button>
              <span class="space-label-value">{{ labelScale.toFixed(2) }}×</span>
              <button type="button" aria-label="放大名字" @click="changeLabelScale(0.25)">A＋</button>
            </div>
            <button
              class="space-cover-toggle"
              :class="{ active: features.boxCover }"
              type="button"
              :aria-pressed="features.boxCover"
              :title="features.boxCover ? '箱子皮肤：显示封面' : '箱子皮肤：白模'"
              @click="toggleCover"
            >
              <AppIcon name="image" :size="15" />箱子皮肤
            </button>
          </div>
          <p class="space-status" v-if="searchingActive">
            <template v-if="searching">正在查找…</template>
            <template v-else-if="searchError">{{ searchError }}</template>
            <template v-else-if="highlightCount">已高亮 {{ highlightCount }} 个位置</template>
            <template v-else>没有找到对应位置</template>
          </p>
          <p class="space-status" v-else>中键旋转 · 右键平移 · 滚轮缩放 · 左键选中 · G/S/R 移动/缩放/旋转</p>
        </div>
      </div>

      <aside v-if="panelOpen" class="space-panel">
        <details class="space-help">
          <summary>
            <AppIcon name="help" :size="16" />
            <span>操作说明（Blender 习惯）</span>
            <AppIcon class="space-help-arrow" name="down" :size="16" />
          </summary>
          <div class="space-help-body">
            <div class="space-help-group">
              <span class="space-help-title">视角</span>
              <ul>
                <li><kbd>中键</kbd> 拖动旋转</li>
                <li><kbd>右键</kbd> 拖动平移</li>
                <li><kbd>滚轮</kbd> 缩放</li>
                <li><kbd>小键盘 1 / 3 / 7</kbd> 前 / 右 / 顶视图</li>
                <li><kbd>小键盘 0</kbd> 回到默认视角</li>
                <li><kbd>Home</kbd> 显示全部 · <kbd>F</kbd> 聚焦选中箱子</li>
              </ul>
            </div>
            <div class="space-help-group">
              <span class="space-help-title">摆放箱子</span>
              <ul>
                <li><kbd>左键</kbd> 点选箱子</li>
                <li><kbd>G</kbd> 移动（随鼠标在房间里滑动）</li>
                <li><kbd>S</kbd> 缩放（向外拖大、向内拖小）</li>
                <li><kbd>R</kbd> 旋转（每按一次转 90°）</li>
                <li><kbd>Enter</kbd>/左键 确认 · <kbd>Esc</kbd> 取消</li>
              </ul>
            </div>
            <p class="space-help-note">也可以在右侧输入数值后「保存摆位」。</p>
          </div>
        </details>

        <p v-if="!allContainers.length" class="space-empty">
          还没有箱子。先在「物品」页添加箱子，再回来摆放它们。
        </p>

        <template v-else>
          <details class="space-help">
            <summary>
              <AppIcon name="box" :size="16" />
              <span>箱子列表（{{ displayBoxes.length }}）</span>
              <AppIcon class="space-help-arrow" name="down" :size="16" />
            </summary>
            <div class="space-box-body">
              <div class="space-panel-head">
                <span>{{ unplaced.length }} 个待摆放</span>
                <button
                  class="outline-btn"
                  :disabled="arranging || !unplaced.length"
                  @click="arrangeUnplaced"
                >
                  {{ arranging ? '摆放中…' : `一键摆放 (${unplaced.length})` }}
                </button>
              </div>
              <div class="space-box-list">
                <button
                  v-for="box in displayBoxes"
                  :key="box.id"
                  class="space-box-row"
                  :class="{ active: box.selected, match: box.highlighted }"
                  @click="selectBox(box.id, true)"
                >
                  <span class="space-box-name">{{ box.name }}</span>
                  <span class="space-box-meta">{{ box.itemCount }} 件</span>
                  <span class="space-box-pos">{{ round(box.x) }}, {{ round(box.z) }}</span>
                </button>
              </div>
            </div>
          </details>

          <div v-if="selectedBox" class="space-editor">
            <div class="space-editor-head">
              <AppIcon name="edit" :size="16" /><span>{{ selectedBox.name }}</span>
            </div>
            <div class="space-fields">
              <label>左右 X<input v-model.number="form.x" type="number" step="0.5" /></label>
              <label>前后 Z<input v-model.number="form.z" type="number" step="0.5" /></label>
              <label>离地 Y<input v-model.number="form.y" type="number" step="0.5" min="0" /></label>
              <label>宽<input v-model.number="form.w" type="number" step="0.5" :min="MIN_SIZE" /></label>
              <label>高<input v-model.number="form.h" type="number" step="0.5" :min="MIN_SIZE" /></label>
              <label>深<input v-model.number="form.d" type="number" step="0.5" :min="MIN_SIZE" /></label>
            </div>
            <div class="space-editor-actions">
              <button class="primary-btn" :disabled="saving" @click="saveBox">
                {{ saving ? '保存中…' : '保存摆位' }}
              </button>
              <button class="outline-btn" @click="locate(selectedBox)">定位</button>
            </div>
          </div>
          <div v-else class="space-editor-hint">点击房间里的箱子，或从列表中选择一个来调整位置和大小。</div>
        </template>
      </aside>
    </div>
  </section>
</template>
