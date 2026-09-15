<script setup lang="ts">
import { computed, ref } from 'vue'
import { useAppStore } from '../store'
import { useItemModals } from '../composables/useItemModals'
import { useAppBootstrap } from '../composables/useAppBootstrap'
import { useImagePreview } from '../composables/useImagePreview'
import { useToast } from '../composables/useToast'
import { api, attachmentUrl } from '../api'
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

function onItemSaved() { return refreshData() }
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
        :class="{ 'sort-editing': editingSort }"
        @click="editingSort ? undefined : modals.openHistory(item)">
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
          <button class="open-btn" @click.stop="modals.openHistory(item)">记录</button>
        </div>
      </article>
    </div>
    <div v-else class="empty">
      <h3>{{ selectedMember?.name }}还没有箱子</h3>
      <p>在物品总览或这里直接创建第一个箱子。</p>
      <button class="primary-btn" @click="modals.openAddContainer">＋ 新建箱子</button>
    </div>
  </div>
</template>
