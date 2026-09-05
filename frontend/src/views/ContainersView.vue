<script setup lang="ts">
import { computed } from 'vue'
import { RecycleScroller } from 'vue-virtual-scroller'
import { useAppStore } from '../store'
import { useItemModals } from '../composables/useItemModals'
import { useAppBootstrap } from '../composables/useAppBootstrap'

const store = useAppStore()
const modals = useItemModals()
const { refreshData } = useAppBootstrap()

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
    <RecycleScroller
      v-if="filteredContainers.length"
      :items="filteredContainers"
      :item-size="160"
      key-field="id"
      class="virtual-list containers-grid"
      v-slot="{ item }">
      <article class="container-card" @click="modals.openHistory(item)">
        <div class="container-card-top">
          <div class="box-mark">▦</div>
          <span class="owner-badge">{{ item.owner_name }}</span>
        </div>
        <h4>{{ item.name }}</h4>
        <p>{{ item.notes || '收纳位置' }}</p>
        <div class="container-bottom">
          <span>{{ item.item_count }} 类 · {{ item.quantity_sum }} 件/组</span>
          <span>查看记录 →</span>
        </div>
      </article>
    </RecycleScroller>
    <div v-else class="empty">
      <h3>{{ selectedMember?.name }}还没有箱子</h3>
      <p>在物品总览或这里直接创建第一个箱子。</p>
      <button class="primary-btn" @click="modals.openAddContainer">＋ 新建箱子</button>
    </div>
  </div>
</template>
