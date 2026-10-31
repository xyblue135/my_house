<script setup lang="ts">
import { computed, onBeforeUnmount, onDeactivated, ref, watch } from 'vue'
import { useAppStore } from '../store'
import { useItemModals } from '../composables/useItemModals'
import { useAppBootstrap } from '../composables/useAppBootstrap'
import { useToast } from '../composables/useToast'
import { containerInScope, scopeLabel } from '../composables/useSearchScope'
import { useVoiceInput } from '../composables/useVoiceInput'
import { speak } from '../composables/useSpeech'
import { api, attachmentUrl } from '../api'
import ContainerDetailModal from '../components/ContainerDetailModal.vue'
import AiAssistantPanel from '../components/AiAssistantPanel.vue'
import AppIcon from '../components/AppIcon.vue'
import type { Container, Item } from '../types'

const store = useAppStore()
const modals = useItemModals()
const { refreshData } = useAppBootstrap()
const { toast } = useToast()
const openContainerId = ref<number | null>(null)
const activeGroupId = ref<number | 'all' | 'ungrouped'>('all')
const query = ref('')
const aiEnabled = ref(false)
const aiBusy = ref(false)
const aiPanel = ref<InstanceType<typeof AiAssistantPanel> | null>(null)
// 语音输入只在安卓 App 里显示（原生语音识别），网页端隐藏
const voice = useVoiceInput()
function onVoice() {
  void voice.toggle({
    partial: (text) => { query.value = text },
    final: (text) => {
      query.value = text
      if (text.trim()) submitSearch()
    },
    error: (message) => toast(message),
  })
}
// 房间概念已下线：AI 始终在全库范围查找
const allOwnerIds = computed(() => store.members.map((member) => member.id))
const searchResults = ref<Item[]>([])
const searching = ref(false)
const searchError = ref('')
const groupModal = ref(false)
const groupName = ref('')
const savingGroup = ref(false)
const editingSort = ref(false)
const sortList = ref<Container[]>([])
const dragIndex = ref<number | null>(null)
const savingSort = ref(false)

const allContainers = computed(() => store.containers)
const myGroups = computed(() => store.groups)
const ungroupedCount = computed(() => allContainers.value.filter((c) => c.group_id == null).length)
const totalItems = computed(() => allContainers.value.reduce((sum, c) => sum + c.item_count, 0))
const filteredContainers = computed(() =>
  allContainers.value.filter(
    (c) =>
      activeGroupId.value === 'all' ||
      (activeGroupId.value === 'ungrouped'
        ? c.group_id == null
        : c.group_id === activeGroupId.value),
  ),
)
const displayContainers = computed(() => {
  if (editingSort.value) return sortList.value
  const rows = [...filteredContainers.value]
  if (sortMode.value === 'name') return rows.sort((a, b) => a.name.localeCompare(b.name, 'zh'))
  if (sortMode.value === 'count') return rows.sort((a, b) => b.item_count - a.item_count)
  return rows.sort((a, b) => (b.last_opened_at ?? '').localeCompare(a.last_opened_at ?? ''))
})
const currentScopeLabel = computed(() => scopeLabel(myGroups.value))
const matchingContainers = computed(() =>
  store.containers.filter(
    (c) =>
      containerInScope(c) &&
      (c.name + ' ' + (c.notes || ''))
        .toLocaleLowerCase()
        .includes(query.value.trim().toLocaleLowerCase()),
  ),
)
const scopedResults = computed(() =>
  searchResults.value.filter((item) => {
    const container = store.containers.find((c) => c.id === item.container_id)
    return !container || containerInScope(container)
  }),
)
const activeGroup = computed(() => myGroups.value.find((g) => g.id === activeGroupId.value))

// ---- 排序三模式：最近打开 → 名称 → 数量，点击循环 ----
type SortMode = 'recent' | 'name' | 'count'
const SORT_KEY = 'myhouse.containerSort'
const SORT_LABEL: Record<SortMode, string> = { recent: '最近打开', name: '名称', count: '数量' }
const sortMode = ref<SortMode>((localStorage.getItem(SORT_KEY) as SortMode) || 'recent')
const sortModeLabel = computed(() => `排序：${SORT_LABEL[sortMode.value]}`)
function cycleSortMode() {
  const order: SortMode[] = ['recent', 'name', 'count']
  sortMode.value = order[(order.indexOf(sortMode.value) + 1) % order.length]
  localStorage.setItem(SORT_KEY, sortMode.value)
}
function groupCount(groupId: number): number {
  return allContainers.value.filter((c) => c.group_id === groupId).length
}

// ---- 收纳空间默认折叠（记住用户的手动展开/收起） ----
const storageOpen = ref(localStorage.getItem('myhouse.storageOpen') === '1')
function onStorageToggle(event: Event): void {
  const open = (event.target as HTMLDetailsElement).open
  storageOpen.value = open
  localStorage.setItem('myhouse.storageOpen', open ? '1' : '0')
}
const groupRow = ref<HTMLElement | null>(null)
function scrollGroups(dir: number) {
  groupRow.value?.scrollBy({ left: dir * 240, behavior: 'smooth' })
}
function touchContainer(id: number): void {
  void api(`/api/containers/${id}/opened`, { method: 'POST', body: JSON.stringify({}) })
}
function openContainer(id: number): void {
  touchContainer(id)
  openContainerId.value = id
}
watch(activeGroupId, cancelSort)
watch(query, cancelSort)

// Query the server, so search also finds items beyond the initial inventory page.
watch([query, aiEnabled, () => store.items], ([value], _, onCleanup) => {
  const keyword = value.trim()
  searchResults.value = []
  searchError.value = ''
  searching.value = !!keyword && !aiEnabled.value
  if (!keyword || aiEnabled.value) return
  const controller = new AbortController()
  const timer = window.setTimeout(async () => {
    try {
      const result = await api<Item[]>(
        '/api/items?q=' + encodeURIComponent(keyword),
        { signal: controller.signal },
      )
      if (!controller.signal.aborted) searchResults.value = result
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

function submitSearch(event?: Event) {
  if (event instanceof KeyboardEvent && event.isComposing) return
  if (aiEnabled.value && !aiBusy.value) void aiPanel.value?.sendChat(query.value)
}
function useSuggestion(text: string) {
  query.value = text
  submitSearch()
}
function speakResults() {
  const names = scopedResults.value.slice(0, 20).map((item) => item.name)
  const boxes = matchingContainers.value.slice(0, 10).map((c) => c.name)
  const parts: string[] = []
  if (names.length) parts.push(`找到${names.length}件物品：${names.join('，')}`)
  if (boxes.length) parts.push(`相关箱子：${boxes.join('，')}`)
  if (!parts.length) parts.push('没有找到对应的物品')
  void speak(parts.join('。')).catch((error) => toast((error as Error).message))
}

function openAddContainer() {
  modals.openAddContainer(typeof activeGroupId.value === 'number' ? activeGroupId.value : null)
}
function openAddItem() {
  if (!allContainers.value.length) {
    openAddContainer()
    toast('先创建一个箱子，再放入物品')
    return
  }
  modals.openAddItem(allContainers.value[0].id)
}
async function addGroup() {
  const name = groupName.value.trim()
  if (!name || savingGroup.value) return
  savingGroup.value = true
  try {
    await api('/api/groups', {
      method: 'POST',
      body: JSON.stringify({ owner_id: store.members[0]?.id ?? 1, name }),
    })
    await refreshData()
    groupName.value = ''
    groupModal.value = false
    toast('分组已新建')
  } catch (error) {
    toast((error as Error).message)
  } finally {
    savingGroup.value = false
  }
}
async function deleteGroup() {
  const g = activeGroup.value
  if (!g || !window.confirm('删除分组「' + g.name + '」？箱子会保留并回到未分组。')) return
  try {
    await api('/api/groups/' + g.id, { method: 'DELETE' })
    activeGroupId.value = 'all'
    await refreshData()
    toast('分组已删除')
  } catch (error) {
    toast((error as Error).message)
  }
}
function enterSortMode() {
  sortList.value = [...filteredContainers.value]
  editingSort.value = true
}
function cancelSort() {
  editingSort.value = false
  sortList.value = []
}
function moveSort(index: number, delta: number) {
  const target = index + delta
  if (target < 0 || target >= sortList.value.length) return
  const arr = [...sortList.value]
  const [item] = arr.splice(index, 1)
  arr.splice(target, 0, item)
  sortList.value = arr
}
function onDragStart(index: number, event: DragEvent) {
  dragIndex.value = index
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', String(index))
  }
}
function onDragOver(event: DragEvent, index: number) {
  if (!editingSort.value) return
  event.preventDefault()
  if (dragIndex.value == null || dragIndex.value === index) return
  const arr = [...sortList.value]
  const [item] = arr.splice(dragIndex.value, 1)
  arr.splice(index, 0, item)
  sortList.value = arr
  dragIndex.value = index
}
async function saveSort() {
  if (savingSort.value) return
  savingSort.value = true
  try {
    // Keep boxes outside the selected group in their original positions.
    const reordered = [...sortList.value]
    const selectedIds = new Set(reordered.map((c) => c.id))
    const ids = allContainers.value.map((c) =>
      selectedIds.has(c.id) ? reordered.shift()!.id : c.id,
    )
    // 房间概念已从界面下线；按 owner 分别提交排序，兼容历史数据
    const byOwner = new Map<number, number[]>()
    for (const id of ids) {
      const owner = store.containers.find((c) => c.id === id)?.owner_id ?? 1
      const list = byOwner.get(owner) ?? []
      list.push(id)
      byOwner.set(owner, list)
    }
    for (const [ownerId, ownerIds] of byOwner) {
      await api('/api/containers/reorder', {
        method: 'POST',
        body: JSON.stringify({ owner_id: ownerId, ids: ownerIds }),
      })
    }
    cancelSort()
    await refreshData()
    toast('顺序已保存')
  } catch (error) {
    toast((error as Error).message)
  } finally {
    savingSort.value = false
  }
}
onDeactivated(() => {
  openContainerId.value = null
  groupModal.value = false
})
onBeforeUnmount(() => {
  openContainerId.value = null
})
</script>

<template>
  <section class="inventory-view view active">
    <div class="home-hero">
      <svg class="hero-scene" viewBox="0 0 360 190" fill="none" aria-hidden="true" preserveAspectRatio="xMaxYMax meet">
        <defs>
          <linearGradient id="hs-wall" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#ffffff" />
            <stop offset="1" stop-color="#eef4ec" />
          </linearGradient>
          <linearGradient id="hs-roof" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#a9cbb1" />
            <stop offset="1" stop-color="#7ea88a" />
          </linearGradient>
          <linearGradient id="hs-boxface" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#f2d9a8" />
            <stop offset="1" stop-color="#dfb878" />
          </linearGradient>
          <filter id="hs-soft" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="5" />
          </filter>
        </defs>

        <!-- 远景云：缓慢漂移 -->
        <g class="hs-cloud">
          <ellipse cx="60" cy="26" rx="42" ry="13" fill="#ffffffa8" />
          <ellipse cx="98" cy="17" rx="26" ry="10" fill="#ffffff8c" />
        </g>
        <g class="hs-cloud hs-cloud-b">
          <ellipse cx="298" cy="32" rx="36" ry="11" fill="#ffffff7d" />
        </g>

        <!-- 地面 -->
        <ellipse cx="205" cy="158" rx="175" ry="26" fill="#ffffff70" />

        <!-- 小树：轻轻摇曳 -->
        <g class="hs-tree">
          <circle cx="44" cy="110" r="25" fill="#b5d4ba" />
          <circle cx="62" cy="98" r="17" fill="#c6ddc9" />
          <rect x="40" y="130" width="9" height="17" rx="3" fill="#a8bda8" />
        </g>

        <!-- 小房子：渐变墙体 + 柔和落影 -->
        <ellipse cx="192" cy="150" rx="60" ry="10" fill="#25352f" opacity="0.09" filter="url(#hs-soft)" />
        <g class="hs-house">
          <rect x="146" y="78" width="92" height="70" rx="7" fill="url(#hs-wall)" />
          <polygon points="136,80 192,44 248,80" fill="url(#hs-roof)" />
          <rect x="158" y="98" width="21" height="34" rx="4" fill="#cfe3d4" />
          <rect x="196" y="92" width="27" height="21" rx="4" fill="#e7efe6" />
          <rect x="200" y="96" width="19" height="17" rx="2.5" fill="#f6f9f4" />
        </g>

        <!-- 纸箱：渐变盒面 + 轻轻浮动 -->
        <ellipse cx="272" cy="152" rx="34" ry="7" fill="#25352f" opacity="0.08" filter="url(#hs-soft)" />
        <g class="hs-box">
          <rect x="244" y="106" width="56" height="44" rx="5" fill="url(#hs-boxface)" />
          <rect x="244" y="98" width="56" height="13" rx="5" fill="#f4ddb0" />
          <rect x="268" y="98" width="9" height="52" fill="#d3a86e" />
          <rect x="258" y="118" width="28" height="12" rx="2.5" fill="#ffffff59" />
        </g>

        <!-- 星光：错峰闪烁（旋转在父级 g 上，动画只做缩放） -->
        <g transform="rotate(12 313 65)">
          <rect class="hs-sparkle" x="306" y="58" width="14" height="14" rx="4" fill="#f4c95d" />
        </g>
        <g transform="rotate(-10 296 86)">
          <rect class="hs-sparkle hs-d1" x="292" y="82" width="9" height="9" rx="2.5" fill="#f4c95d" opacity="0.7" />
        </g>
        <g transform="rotate(20 321 91)">
          <rect class="hs-sparkle hs-d2" x="318" y="88" width="7" height="7" rx="2" fill="#f4c95d" opacity="0.5" />
        </g>
      </svg>
      <div class="hero-stats">
        <AppIcon name="box" :size="18" />
        <span>目前收纳 <b>{{ allContainers.length }}</b> 个箱子，<b>{{ totalItems }}</b> 种物品。</span>
        <AppIcon class="chev" name="right" :size="15" />
      </div>
    </div>

    <div class="inventory-tools">
      <form class="inventory-search" role="search" @submit.prevent="submitSearch()">
      <div class="search-box" :class="{ 'ai-search-active': aiEnabled }">
        <AppIcon :name="aiEnabled ? 'sparkles' : 'search'" :size="21" />
        <input
          v-model="query"
          type="search"
          :maxlength="aiEnabled ? 2000 : 200"
          :placeholder="aiEnabled ? '找物品，或说说想怎么整理…' : '找物品、箱子…'"
          aria-label="搜索物品或箱子"
          @keydown.enter.prevent="submitSearch($event)"
        />
        <button
          v-if="voice.supported"
          type="button"
          class="icon-btn plain mic-btn"
          :class="{ listening: voice.listening.value }"
          :aria-label="voice.listening.value ? '停止语音输入' : '语音输入'"
          @click.prevent="onVoice"
        >
          <AppIcon name="mic" :size="19" />
        </button>
        <button v-if="query && !aiEnabled" type="button" class="icon-btn plain" aria-label="清空搜索" @click="query = ''">
          <AppIcon name="close" :size="18" />
        </button>
        <button class="search-go" type="submit" :disabled="aiBusy || !query.trim()">
          <AppIcon name="search" :size="16" /><span>查找</span>
        </button>
      </div>
      <label class="ai-search-toggle" :class="{ active: aiEnabled }">
        <input v-model="aiEnabled" type="checkbox" role="switch" :disabled="aiBusy" />
        <span class="toggle-track" aria-hidden="true"></span>
        <span>AI</span>
      </label>
      </form>
    </div>

    <AiAssistantPanel v-if="aiEnabled" ref="aiPanel" :owner-ids="allOwnerIds" scope-label="全部" @busy="aiBusy = $event" @suggestion="useSuggestion" />

    <template v-if="query.trim() && !aiEnabled">
      <div class="section-head">
        <div>
          <h2>搜索结果</h2>
          <p>范围：{{ currentScopeLabel }} 的物品和箱子（范围在设置里调整）</p>
        </div>
        <button class="icon-btn plain" aria-label="朗读搜索结果" title="朗读搜索结果" @click="speakResults">
          <AppIcon name="volume" :size="19" />
        </button>
      </div>
      <p v-if="searching" class="inline-notice" role="status">正在查找…</p>
      <p v-else-if="searchError" class="inline-notice error" role="alert">{{ searchError }}</p>
      <div v-else-if="scopedResults.length" class="search-results">
        <button
          v-for="item in scopedResults"
          :key="item.id"
          class="search-result"
          @click="modals.openEditItem(item)"
        >
          <span class="item-thumbnail">
            <img
              v-if="item.cover_attachment_id"
              :src="attachmentUrl(item.cover_attachment_id)"
              alt=""
            />
          </span>
          <span class="result-copy"
            ><strong>{{ item.name }}</strong
            ><span
              >{{ item.container_name
              }}<template v-if="item.quantity != null"> · {{ item.quantity }} 个</template></span
            ></span
          >
          <AppIcon name="right" :size="18" />
        </button>
        <p v-if="scopedResults.length >= 200" class="muted">
          结果较多，请输入更具体的名称缩小范围。
        </p>
      </div>
      <div v-if="matchingContainers.length" class="search-box-matches">
        <h3>相关箱子</h3>
        <button
          v-for="container in matchingContainers"
          :key="container.id"
          class="search-result"
          @click="openContainer(container.id)"
        >
          <AppIcon name="folder" /><span class="result-copy"
            ><strong>{{ container.name }}</strong
            ><span>{{ container.group_name || '未分组' }} · {{ container.item_count }} 种物品</span></span
          ><AppIcon name="right" :size="18" />
        </button>
      </div>
      <div
        v-if="!searching && !searchError && !scopedResults.length && !matchingContainers.length"
        class="empty"
      >
        <AppIcon name="search" :size="36" />
        <h3>还没找到这件东西</h3>
        <p>试试更短的名称，或到设置里把查找范围改回「全部」。</p>
        <button class="outline-btn" @click="query = ''">返回所有箱子</button>
      </div>
    </template>

    <template v-else>
      <div class="group-tabs" aria-label="按分组筛选">
        <button
          class="group-scroll-btn"
          type="button"
          aria-label="向左滚动分组"
          @click="scrollGroups(-1)"
        >‹</button>
        <div ref="groupRow" class="group-tabs-groups">
          <button
            class="group-tab special"
            :class="{ active: activeGroupId === 'ungrouped' }"
            :aria-pressed="activeGroupId === 'ungrouped'"
            @click="activeGroupId = activeGroupId === 'ungrouped' ? 'all' : 'ungrouped'"
          >
            <AppIcon name="box" :size="15" />未分组<span>{{ ungroupedCount }}</span>
          </button>
          <button
            v-for="group in myGroups"
            :key="group.id"
            class="group-tab"
            :class="{ active: activeGroupId === group.id }"
            :aria-pressed="activeGroupId === group.id"
            @click="activeGroupId = activeGroupId === group.id ? 'all' : group.id"
          >
            <AppIcon name="grid" :size="15" />{{ group.name }}<span>{{ groupCount(group.id) }}</span>
          </button>
          <button class="group-add" @click="groupModal = true">
            <AppIcon name="plus" :size="16" />分组
          </button>
        </div>
        <button
          class="group-scroll-btn"
          type="button"
          aria-label="向右滚动分组"
          @click="scrollGroups(1)"
        >›</button>
      </div>
      <details
        class="storage-fold"
        :open="storageOpen"
        @toggle="onStorageToggle($event)"
      >
        <summary>
          <span class="fold-title">
            {{ activeGroup?.name || (activeGroupId === 'ungrouped' ? '未分组' : '收纳空间')
            }}<span class="count-label">{{ displayContainers.length }}</span>
          </span>
          <span class="inline-actions" @click.stop.prevent>
            <template v-if="editingSort"
              ><button class="text-btn" :disabled="savingSort" @click="cancelSort">取消</button
              ><button class="primary-btn compact" :disabled="savingSort" @click="saveSort">
                保存顺序
              </button></template
            >
            <template v-else
              ><button
                v-if="activeGroup"
                class="icon-btn plain danger"
                aria-label="删除当前分组"
                @click="deleteGroup"
              >
                <AppIcon name="trash" :size="18" /></button
              ><button class="outline-btn compact" @click="openAddContainer">新建箱子</button
              ><button
                v-if="displayContainers.length > 1"
                class="outline-btn compact"
                @click="cycleSortMode"
              >
                {{ sortModeLabel }}</button
              ></template
            >
          </span>
          <AppIcon class="fold-chev" name="down" :size="18" />
        </summary>
        <div class="fold-body">
      <p v-if="editingSort" class="inline-notice">点击箭头调整顺序，再点“保存顺序”。</p>
      <div v-if="displayContainers.length" class="container-rows">
        <article
          v-for="(container, index) in displayContainers"
          :key="container.id"
          class="container-card"
          :class="{ 'sort-editing': editingSort, dragging: dragIndex === index }"
          :draggable="editingSort"
          @dragstart="onDragStart(index, $event)"
          @dragover="onDragOver($event, index)"
          @drop.prevent
          @dragend="dragIndex = null"
        >
          <button
            class="container-open"
            :disabled="editingSort"
            :aria-label="'打开箱子：' + container.name"
            @click="openContainer(container.id)"
          >
            <span class="container-cover" :class="'cover-tone-' + (index % 3)"
              ><img
                v-if="container.cover_attachment_id"
                :src="attachmentUrl(container.cover_attachment_id)"
                alt=""
                loading="lazy" /><AppIcon v-else name="box" :size="30"
            /></span>
            <span class="container-copy"
              ><span class="container-location">{{ container.group_name || '未分组' }}</span
              ><strong>{{ container.name }}</strong
              ><span class="container-summary">{{
                container.item_names || container.notes || '还没有物品，放进第一件吧'
              }}</span
              ><span class="container-count">{{ container.item_count }} 种物品</span></span
            >
            <AppIcon class="container-chevron" name="right" :size="18" />
          </button>
          <div v-if="editingSort" class="sort-controls">
            <button
              class="outline-btn compact"
              :disabled="index === 0 || savingSort"
              :aria-label="'上移' + container.name"
              @click="moveSort(index, -1)"
            >
              <AppIcon name="up" :size="17" />上移</button
            ><button
              class="outline-btn compact"
              :disabled="index === displayContainers.length - 1 || savingSort"
              :aria-label="'下移' + container.name"
              @click="moveSort(index, 1)"
            >
              <AppIcon name="lower" :size="17" />下移
            </button>
          </div>
        </article>
      </div>
      <div v-else class="empty">
        <AppIcon name="box" :size="40" />
        <h3>给物品安个家</h3>
        <p>
          {{ activeGroupId === 'all' ? '从一个抽屉、一个收纳箱开始。' : '这个分组暂时没有箱子。' }}
        </p>
        <button class="primary-btn" @click="openAddContainer">
          <AppIcon name="plus" />新建箱子
        </button>
      </div>
      <p v-if="displayContainers.length" class="list-end">收好的是物品，也是日常。</p>
        </div>
      </details>
    </template>
  </section>
  <ContainerDetailModal :container-id="openContainerId" @close="openContainerId = null" />
  <div
    v-if="groupModal"
    v-dialog="() => (groupModal = false)"
    class="modal-backdrop"
    aria-label="新建分组"
    @click.self="groupModal = false"
  >
    <section class="modal small">
      <div class="modal-head">
        <div>
          <p class="eyebrow">整理空间</p>
          <h2>新建分组</h2>
        </div>
        <button class="icon-btn plain" aria-label="关闭分组表单" @click="groupModal = false">
          <AppIcon name="close" />
        </button>
      </div>
      <form class="modal-form one-col" @submit.prevent="addGroup">
        <label
          >分组名称<input
            v-model="groupName"
            required
            maxlength="80"
            placeholder="如：客厅、厨房、书房"
        /></label>
        <div class="modal-actions">
          <button type="button" class="outline-btn" @click="groupModal = false">取消</button
          ><button class="primary-btn" :disabled="savingGroup">
            {{ savingGroup ? '保存中…' : '创建分组' }}
          </button>
        </div>
      </form>
    </section>
  </div>
</template>
