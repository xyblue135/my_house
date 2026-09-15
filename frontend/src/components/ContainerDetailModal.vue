<script setup lang="ts">
import { computed, watch } from 'vue'
import { useAppStore } from '../store'
import { useItemModals } from '../composables/useItemModals'
import { useAppBootstrap } from '../composables/useAppBootstrap'
import { useImagePreview } from '../composables/useImagePreview'
import { attachmentUrl } from '../api'
import type { Item } from '../types'

const props = defineProps<{ containerId: number | null }>()
const emit = defineEmits<{ close: [] }>()

const store = useAppStore()
const modals = useItemModals()
const { refreshData } = useAppBootstrap()
const preview = useImagePreview()

const container = computed(() => props.containerId == null ? null : store.containers.find(c => c.id === props.containerId) ?? null)
const items = computed(() => props.containerId == null ? [] : store.items.filter(i => i.container_id === props.containerId))

function firstChar(name: string) { return (name || '物').trim().charAt(0).toUpperCase() }
function quantityText(item: Item) { return item.quantity_text || (item.quantity == null ? '未记录' : `${item.quantity} 个`) }
function openCoverPreview(id: number | null | undefined) { if (id) preview.open([attachmentUrl(id)]) }
function onItemEdit(item: Item) { modals.openEditItem(item) }
function onItemDelete(item: Item) { modals.deleteItem(item, () => refreshData()) }

watch(() => props.containerId, (id) => {
  document.body.classList.toggle('modal-open', id != null)
})
</script>

<template>
  <div v-if="container" class="modal-backdrop container-detail-backdrop" @click.self="emit('close')">
    <div class="modal container-detail-modal">
      <div class="container-detail-head">
        <div class="container-detail-title-wrap">
          <div class="container-detail-cover">
            <img v-if="container.cover_attachment_id" :src="attachmentUrl(container.cover_attachment_id)" alt="" @click.stop="openCoverPreview(container.cover_attachment_id)" />
            <div v-else class="box-mark large">▦</div>
          </div>
          <div>
            <p class="eyebrow">{{ container.owner_name }} / CONTAINER</p>
            <h3>{{ container.name }}</h3>
            <p class="container-detail-note">{{ container.notes || '空备注' }}</p>
          </div>
        </div>
        <button class="icon-btn" @click="emit('close')">×</button>
      </div>
      <div class="container-detail-toolbar">
        <span>{{ container.item_count }} 类 · {{ container.quantity_sum }} 件/组</span>
        <div class="inline-actions">
          <button class="outline-btn compact" @click="modals.openHistory(container)">操作记录</button>
          <button class="outline-btn compact" @click="modals.openEditContainer(container)">编辑箱子</button>
          <button class="primary-btn compact" @click="modals.openAddItem(container.id)">＋ 放入物品</button>
        </div>
      </div>
      <div v-if="items.length" class="container-detail-items">
        <article v-for="item in items" :key="item.id" class="container-item-row">
          <div class="container-item-icon thumb">
            <img v-if="item.cover_attachment_id" :src="attachmentUrl(item.cover_attachment_id)" alt="" loading="lazy" @click.stop="openCoverPreview(item.cover_attachment_id)" />
            <template v-else>{{ firstChar(item.name) }}</template>
          </div>
          <div class="container-item-main">
            <h4>{{ item.name }}</h4>
            <p>{{ item.notes }}</p>
            <div class="item-meta">
              <span class="chip">{{ quantityText(item) }}</span>
              <span v-if="item.expiry_date" class="chip life">{{ item.expiry_date }}</span>
              <span v-if="item.attachment_count" class="chip">附件 {{ item.attachment_count }}</span>
            </div>
          </div>
          <div class="container-item-actions">
            <button class="icon-btn" @click="onItemEdit(item)">✎</button>
            <button class="icon-btn danger" @click="onItemDelete(item)">×</button>
          </div>
        </article>
      </div>
      <div v-else class="container-detail-empty"><h3>这个箱子还没有物品</h3></div>
    </div>
  </div>
</template>
