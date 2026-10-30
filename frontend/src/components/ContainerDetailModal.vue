<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import AppIcon from './AppIcon.vue'
import { useAppStore } from '../store'
import { useItemModals } from '../composables/useItemModals'
import { useAppBootstrap } from '../composables/useAppBootstrap'
import { useImagePreview } from '../composables/useImagePreview'
import { useToast } from '../composables/useToast'
import { api, attachmentUrl } from '../api'
import type { Item } from '../types'

const props = defineProps<{ containerId: number | null }>()
const emit = defineEmits<{ close: [] }>()

const store = useAppStore()
const modals = useItemModals()
const { refreshData } = useAppBootstrap()
const preview = useImagePreview()
const { toast } = useToast()

const container = computed(() =>
  props.containerId == null
    ? null
    : (store.containers.find((c) => c.id === props.containerId) ?? null),
)
// 当前箱子归属房间下的分组
const ownerGroups = computed(() => {
  const c = container.value
  if (!c) return []
  return store.groups.filter((g) => g.owner_id === c.owner_id)
})
// 箱内物品按添加先后正序显示（后添加的排在后面）
const items = ref<Item[]>([])
const loading = ref(false)
const loadError = ref('')
watch([() => props.containerId, () => store.items], async ([id], _, onCleanup) => {
  if (id == null) {
    items.value = []
    return
  }
  const controller = new AbortController()
  onCleanup(() => controller.abort())
  items.value = []
  loading.value = true
  loadError.value = ''
  try {
    const data = await api<Item[]>('/api/items?container_id=' + id, { signal: controller.signal })
    if (!controller.signal.aborted) items.value = data.sort((a, b) => a.id - b.id)
  } catch (error) {
    if (!controller.signal.aborted) loadError.value = (error as Error).message
  } finally {
    if (!controller.signal.aborted) loading.value = false
  }
})

function quantityText(item: Item) {
  return item.quantity == null ? '未记录' : `${item.quantity} 个`
}
function openCoverPreview(id: number | null | undefined) {
  if (id) preview.open([attachmentUrl(id)])
}
function onItemEdit(item: Item) {
  modals.openEditItem(item)
}
function onItemDelete(item: Item) {
  modals.deleteItem(item, () => refreshData())
}

async function moveToGroup(groupId: number | null) {
  const c = container.value
  if (!c) return
  try {
    await api(`/api/containers/${c.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ group_id: groupId }),
    })
    toast(groupId == null ? '已移动到默认分组' : '已移动分组')
    await refreshData()
  } catch (error) {
    toast((error as Error).message)
  }
}
</script>

<template>
  <div
    v-if="container"
    v-dialog="() => emit('close')"
    :aria-label="container.name"
    class="modal-backdrop container-detail-backdrop"
    @click.self="emit('close')"
  >
    <div class="modal container-detail-modal">
      <div class="container-detail-head">
        <div class="container-detail-title-wrap">
          <div class="container-detail-cover">
            <img
              v-if="container.cover_attachment_id"
              :src="attachmentUrl(container.cover_attachment_id)"
              alt=""
              @click.stop="openCoverPreview(container.cover_attachment_id)"
            />
            <div v-else class="box-mark large"><AppIcon name="box" :size="27" /></div>
          </div>
          <div>
            <p class="eyebrow">{{ container.owner_name }} · {{ container.item_count }} 种物品</p>
            <h3>{{ container.name }}</h3>
            <p v-if="container.notes" class="container-detail-note">{{ container.notes }}</p>
          </div>
        </div>
        <button class="icon-btn plain" aria-label="关闭箱子详情" @click="emit('close')">
          <AppIcon name="close" />
        </button>
      </div>
      <div class="container-detail-toolbar">
        <div class="inline-actions" style="margin-left: auto">
          <select
            class="group-move-select"
            aria-label="移动到分组"
            :value="container.group_id ?? null"
            @change="
              moveToGroup(
                ($event.target as HTMLSelectElement).value === ''
                  ? null
                  : Number(($event.target as HTMLSelectElement).value),
              )
            "
          >
            <option :value="''">未分组</option>
            <option v-for="g in ownerGroups" :key="g.id" :value="g.id">{{ g.name }}</option>
          </select>
          <button class="outline-btn compact" @click="modals.openHistory(container)">
            操作记录
          </button>
          <button class="outline-btn compact" @click="modals.openEditContainer(container)">
            编辑箱子
          </button>
          <button class="primary-btn compact" @click="modals.openAddItem(container.id)">
            <AppIcon name="plus" :size="17" />放入物品
          </button>
        </div>
      </div>
      <div v-if="loading || loadError" class="container-detail-empty" role="status">
        {{ loadError || '正在打开箱子…' }}
      </div>
      <div v-else-if="items.length" class="container-detail-items">
        <p v-if="items.length < container.item_count" class="inline-notice">
          当前显示 {{ items.length }} 种物品；更多物品可通过首页搜索查找。
        </p>
        <article v-for="item in items" :key="item.id" class="container-item-row">
          <div class="container-item-icon thumb">
            <img
              v-if="item.cover_attachment_id"
              :src="attachmentUrl(item.cover_attachment_id)"
              alt=""
              loading="lazy"
              @click.stop="openCoverPreview(item.cover_attachment_id)"
            />
          </div>
          <div class="container-item-main">
            <h4>{{ item.name }}</h4>
            <div class="item-meta">
              <span class="chip">{{ quantityText(item) }}</span>
              <span v-if="item.attachment_count" class="chip"
                >附件 {{ item.attachment_count }}</span
              >
            </div>
          </div>
          <div class="container-item-actions">
            <button
              class="icon-btn plain"
              :aria-label="'编辑物品：' + item.name"
              @click="onItemEdit(item)"
            >
              <AppIcon name="edit" :size="18" />
            </button>
            <button
              class="icon-btn plain danger"
              :aria-label="'删除物品：' + item.name"
              @click="onItemDelete(item)"
            >
              <AppIcon name="trash" :size="17" />
            </button>
          </div>
        </article>
      </div>
      <div v-else class="container-detail-empty"><h3>这个箱子还没有物品</h3></div>
    </div>
  </div>
</template>
