<script setup lang="ts">
import { computed } from 'vue'
import { useAppStore } from '../store'
import { useItemModals } from '../composables/useItemModals'
import { useAppBootstrap } from '../composables/useAppBootstrap'
import { useImagePreview } from '../composables/useImagePreview'
import { attachmentUrl } from '../api'

const store = useAppStore()
const modals = useItemModals()
const { refreshData } = useAppBootstrap()
const preview = useImagePreview()

function openCoverPreview(id: number | null | undefined) {
  if (!id) return
  preview.open([attachmentUrl(id)])
}

const filteredContainers = computed(() => store.containers.filter(c => c.owner_id === store.selectedOwnerId))
const selectedMember = computed(() => store.members.find(m => m.id === store.selectedOwnerId))

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
        <button class="outline-btn" @click="modals.openBatch">批量操作</button>
        <button class="primary-btn" @click="modals.openAddContainer">＋ 新建箱子</button>
      </div>
    </div>
    <div v-if="filteredContainers.length" class="containers-grid">
      <article v-for="item in filteredContainers" :key="item.id" class="container-card" @click="modals.openHistory(item)">
        <div class="container-cover">
          <img v-if="item.cover_attachment_id" :src="attachmentUrl(item.cover_attachment_id)" alt="" loading="lazy" @click.stop="openCoverPreview(item.cover_attachment_id)" />
          <div v-else class="container-cover-empty">▦</div>
          <span class="owner-badge">{{ item.owner_name }}</span>
        </div>
        <h4>{{ item.name }}</h4>
        <div class="item-names">{{ item.item_names || '' }}</div>
        <p>{{ item.notes || '收纳位置' }}</p>
        <div class="container-bottom">
          <span>{{ item.item_count }} 类 · {{ item.quantity_sum }} 件/组</span>
          <span>查看记录 →</span>
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
