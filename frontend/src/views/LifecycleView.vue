<script setup lang="ts">
import { computed, ref } from 'vue'
import { RecycleScroller } from 'vue-virtual-scroller'
import { api } from '../api'
import { useAppStore } from '../store'
import { useToast } from '../composables/useToast'
import { useItemModals } from '../composables/useItemModals'
import { useAppBootstrap } from '../composables/useAppBootstrap'
import type { Item, LifecycleEntry } from '../types'

const store = useAppStore()
const { toast } = useToast()
const modals = useItemModals()
const { refreshData } = useAppBootstrap()

const lifecycleStatus = ref('ALL')
const visibleLifecycles = computed(() => store.lifecycles.filter(l => l.owner_id === store.selectedOwnerId))

function lifecycleLabel(type?: string | null) { return ({ EXPIRY:'有效期', WARRANTY:'保修', REPLACE:'建议更换', CHECK:'定期检查' } as Record<string,string>)[type || ''] || '生命周期' }
function lifecycleStatusLabel(status: string) { return ({ EXPIRED:'已到期', DUE:'即将到期', ACTIVE:'正常', NO_DATE:'未设日期' } as Record<string,string>)[status] || status }

async function loadLifecycle() {
  try { store.lifecycles = await api<LifecycleEntry[]>(`/api/lifecycle?status=${lifecycleStatus.value}`) }
  catch (error) { toast((error as Error).message) }
}
function setLifecycleStatus(status: string) { lifecycleStatus.value = status; loadLifecycle() }

function editLifecycle(entry: LifecycleEntry) {
  const item = store.items.find(i => i.id === entry.item_id)
  if (item) modals.openEditItem(item)
}
</script>

<template>
  <div class="view active">
    <div class="lifecycle-summary">
      <article><span>全部</span><strong>{{ store.dashboard?.lifecycle.total ?? 0 }}</strong></article>
      <article><span>7 天内</span><strong>{{ store.dashboard?.lifecycle.due7 ?? 0 }}</strong></article>
      <article><span>30 天内</span><strong>{{ store.dashboard?.lifecycle.due30 ?? 0 }}</strong></article>
      <article class="danger"><span>已到期</span><strong>{{ store.dashboard?.lifecycle.expired ?? 0 }}</strong></article>
    </div>
    <div class="filter-tabs">
      <button v-for="s in [['ALL','全部'],['DUE','即将到期'],['EXPIRED','已到期'],['ACTIVE','正常']]" :key="s[0]" :class="{active:lifecycleStatus===s[0]}" @click="setLifecycleStatus(s[0])">{{ s[1] }}</button>
    </div>
    <div class="section-head">
      <div><h3>生命周期物品</h3><p>统一管理食品/调料有效期、电池更换、保修和定期检查。</p></div>
    </div>
    <RecycleScroller
      v-if="visibleLifecycles.length"
      :items="visibleLifecycles"
      :item-size="88"
      key-field="id"
      class="virtual-list lifecycle-list"
      v-slot="{ item }">
      <article :class="['lifecycle-row', item.lifecycle_status.toLowerCase()]" @click="editLifecycle(item)">
        <div class="life-date">
          <strong>{{ item.days_left == null ? '—' : item.days_left }}</strong>
          <span>{{ item.days_left == null ? '无日期' : item.days_left < 0 ? '天前' : '天' }}</span>
        </div>
        <div class="life-main">
          <h4>{{ item.item_name }}</h4>
          <p>{{ item.owner_name }} · {{ item.container_name }} · {{ lifecycleLabel(item.lifecycle_type) }}</p>
          <small>{{ item.expiry_date || '未设置日期' }}<template v-if="item.notes"> · {{ item.notes }}</template></small>
        </div>
        <span class="life-status">{{ lifecycleStatusLabel(item.lifecycle_status) }}</span>
      </article>
    </RecycleScroller>
    <div v-else class="empty">
      <h3>没有生命周期记录</h3>
      <p>编辑任意物品，打开"生命周期"开关即可添加。</p>
    </div>
  </div>
</template>
