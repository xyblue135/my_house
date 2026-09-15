<script setup lang="ts">
import { computed, ref } from 'vue'
import { useAppStore } from '../store'
import { useItemModals } from '../composables/useItemModals'
import { useAppBootstrap } from '../composables/useAppBootstrap'
import { useImagePreview } from '../composables/useImagePreview'
import { useToast } from '../composables/useToast'
import { api, attachmentUrl } from '../api'
import ContainerDetailModal from '../components/ContainerDetailModal.vue'
import type { Container } from '../types'

const store = useAppStore()
const modals = useItemModals()
const { refreshData } = useAppBootstrap()
const preview = useImagePreview()
const { toast } = useToast()

function openCoverPreview(id: number | null | undefined) {
  if (!id) return
  preview.open([attachmentUrl(id)])
}

const openContainerId = ref<number | null>(null)
function openContainerDetail(id: number) { openContainerId.value = id }
function closeContainerDetail() { openContainerId.value = null }

const filteredContainers = computed(() => store.containers.filter(c => c.owner_id === store.selectedOwnerId))
const selectedMember = computed(() => store.members.find(m => m.id === store.selectedOwnerId))

// 编辑排序模式：进入后卡片显示上移/下移，点保存调 reorder API
const editingSort = ref(false)
const sortList = ref<Container[]>([])
const displayContainers = computed(() => editingSort.value ? sortList.value : filteredContainers.value)

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
// 拖拽排序（桌面端）：拖到目标卡片上即插入到该位置
const dragIndex = ref<number | null>(null)
function onDragStart(index: number, event: DragEvent) {
  dragIndex.value = index
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
    try { event.dataTransfer.setData('text/plain', String(index)) } catch { /* ignore */ }
  }
}
function onDragOver(event: DragEvent, index: number) {
  event.preventDefault()
  if (dragIndex.value == null || dragIndex.value === index) return
  const from = dragIndex.value
  const arr = [...sortList.value]
  const [item] = arr.splice(from, 1)
  arr.splice(index, 0, item)
  sortList.value = arr
  dragIndex.value = index
}
function onDragEnd() { dragIndex.value = null }
async function saveSort() {
  const ids = sortList.value.map(c => c.id)
  try {
    await api('/api/containers/reorder', {
      method: 'POST',
      body: JSON.stringify({ owner_id: store.selectedOwnerId, ids }),
    })
    editingSort.value = false
    sortList.value = []
    await refreshData()
    toast('顺序已保存')
  } catch (error) { toast((error as Error).message) }
}
</script>

<template>
  <div class="view active">
    <div class="section-head row-mobile">
      <div>
        <h3>{{ selectedMember?.name }}的箱子管理</h3>
        <p>当前不加入房间层级，箱子直接归属家庭成员。</p>
      </div>
      <div class="inline-actions">
        <template v-if="editingSort">
          <button class="primary-btn" @click="saveSort">保存顺序</button>
          <button class="outline-btn" @click="cancelSort">取消</button>
        </template>
        <template v-else>
          <button class="outline-btn" @click="enterSortMode">编辑排序</button>
          <button class="outline-btn" @click="modals.openBatch">批量操作</button>
          <button class="primary-btn" @click="modals.openAddContainer">＋ 新建箱子</button>
        </template>
      </div>
    </div>
    <div v-if="displayContainers.length" class="containers-grid">
      <article
        v-for="(item, index) in displayContainers"
        :key="item.id"
        class="container-card"
        :class="{ 'sort-editing': editingSort, dragging: dragIndex === index }"
        :draggable="editingSort"
        @dragstart="onDragStart(index, $event)"
        @dragover="onDragOver($event, index)"
        @drop.prevent
        @dragend="onDragEnd"
        @click="editingSort ? undefined : openContainerDetail(item.id)">
        <div v-if="editingSort" class="sort-controls">
          <button class="icon-btn sort-btn" :disabled="index === 0" @click.stop="moveSort(index, -1)">↑</button>
          <button class="icon-btn sort-btn" :disabled="index === displayContainers.length - 1" @click.stop="moveSort(index, 1)">↓</button>
        </div>
        <div class="container-cover">
          <img v-if="item.cover_attachment_id" :src="attachmentUrl(item.cover_attachment_id)" alt="" loading="lazy" @click.stop="openCoverPreview(item.cover_attachment_id)" />
          <div v-else class="container-cover-empty">▦</div>
          <span class="owner-badge">{{ item.owner_name }}</span>
        </div>
        <h4>{{ item.name }}</h4>
        <div class="item-names">{{ item.item_names || '' }}</div>
        <p>{{ item.notes || '空备注' }}</p>
        <div class="container-bottom">
          <button class="open-btn" @click.stop="openContainerDetail(item.id)">打开</button>
        </div>
      </article>
    </div>
    <div v-else class="empty">
      <h3>{{ selectedMember?.name }}还没有箱子</h3>
      <p>在物品总览或这里直接创建第一个箱子。</p>
      <button class="primary-btn" @click="modals.openAddContainer">＋ 新建箱子</button>
    </div>
  </div>

  <ContainerDetailModal :container-id="openContainerId" @close="closeContainerDetail" />
</template>
