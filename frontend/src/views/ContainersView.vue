<script setup lang="ts">
import { computed, onBeforeUnmount, onDeactivated, ref, watch } from 'vue'
import { useAppStore } from '../store'
import { useItemModals } from '../composables/useItemModals'
import { useAppBootstrap } from '../composables/useAppBootstrap'
import { useToast } from '../composables/useToast'
import { containerInScope, scopeLabel } from '../composables/useSearchScope'
import { useVoiceInput } from '../composables/useVoiceInput'
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
const displayContainers = computed(() =>
  editingSort.value ? sortList.value : filteredContainers.value,
)
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
    <div class="page-heading">
      <div>
        <p class="eyebrow">收好每一份日常</p>
        <h1>家里的物品</h1>
        <p class="page-description">
          {{ allContainers.length }} 个箱子，{{ totalItems }} 种物品，都有迹可寻。
        </p>
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
        <button v-if="query" type="button" class="icon-btn plain" aria-label="清空搜索" @click="query = ''">
          <AppIcon name="close" :size="18" />
        </button>
      </div>
      <label class="ai-search-toggle" :class="{ active: aiEnabled }">
        <input v-model="aiEnabled" type="checkbox" role="switch" :disabled="aiBusy" />
        <span class="toggle-track" aria-hidden="true"></span>
        <span>AI 查找</span>
      </label>
      <button v-if="aiEnabled" type="submit" class="primary-btn search-submit" :disabled="aiBusy || !query.trim()">
        {{ aiBusy ? '处理中…' : '查找' }}
      </button>
      </form>
      <div class="quick-actions">
        <button class="primary-btn" @click="openAddItem"><AppIcon name="plus" />添加物品</button>
        <button class="outline-btn" @click="openAddContainer">
          <AppIcon name="box" />新建箱子
        </button>
      </div>
    </div>

    <AiAssistantPanel v-if="aiEnabled" ref="aiPanel" :owner-ids="allOwnerIds" scope-label="全部" @busy="aiBusy = $event" @suggestion="useSuggestion" />

    <template v-if="query.trim() && !aiEnabled">
      <div class="section-head">
        <div>
          <h2>搜索结果</h2>
          <p>范围：{{ currentScopeLabel }} 的物品和箱子（范围在设置里调整）</p>
        </div>
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
          @click="openContainerId = container.id"
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
        <div class="group-tabs-special">
          <button
            class="group-tab special"
            :class="{ active: activeGroupId === 'all' }"
            :aria-pressed="activeGroupId === 'all'"
            @click="activeGroupId = 'all'"
          >
            <AppIcon name="grid" :size="15" />全部<span>{{ allContainers.length }}</span>
          </button>
          <button
            class="group-tab special"
            :class="{ active: activeGroupId === 'ungrouped' }"
            :aria-pressed="activeGroupId === 'ungrouped'"
            @click="activeGroupId = 'ungrouped'"
          >
            <AppIcon name="box" :size="15" />未分组<span>{{ ungroupedCount }}</span>
          </button>
        </div>
        <div class="group-tabs-groups">
          <button
            v-for="group in myGroups"
            :key="group.id"
            class="group-tab"
            :class="{ active: activeGroupId === group.id }"
            :aria-pressed="activeGroupId === group.id"
            @click="activeGroupId = group.id"
          >
            {{ group.name }}
          </button>
          <button class="group-add" @click="groupModal = true">
            <AppIcon name="plus" :size="16" />分组
          </button>
        </div>
      </div>
      <div class="section-head inventory-section-head">
        <div>
          <h2>
            {{ activeGroup?.name || (activeGroupId === 'ungrouped' ? '未分组' : '收纳空间')
            }}<span class="count-label">{{ displayContainers.length }}</span>
          </h2>
        </div>
        <div class="inline-actions">
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
            ><button v-if="displayContainers.length > 1" class="text-btn" @click="enterSortMode">
              <AppIcon name="sort" :size="17" />排序</button
            ></template>
        </div>
      </div>
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
            @click="openContainerId = container.id"
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
