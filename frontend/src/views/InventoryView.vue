<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { RecycleScroller } from 'vue-virtual-scroller'
import { api } from '../api'
import { useAppStore } from '../store'
import { useToast } from '../composables/useToast'
import { useItemModals } from '../composables/useItemModals'
import { useAppBootstrap } from '../composables/useAppBootstrap'
import type { HistoryEntry, Item } from '../types'

const store = useAppStore()
const router = useRouter()
const { toast } = useToast()
const modals = useItemModals()
const { refreshData } = useAppBootstrap()

const search = ref('')
const searchResults = ref<Item[]>([])
let searchTimer: number | undefined
const searching = computed(() => Boolean(search.value.trim()))
const openContainerId = ref<number | null>(null)

const filteredContainers = computed(() => store.containers.filter(c => c.owner_id === store.selectedOwnerId))
const filteredItems = computed(() => store.items.filter(i => i.owner_id === store.selectedOwnerId))
const openContainer = computed(() => store.containers.find(c => c.id === openContainerId.value) ?? null)
const openContainerItems = computed(() => openContainerId.value == null ? [] : store.items.filter(i => i.container_id === openContainerId.value))
const selectedMember = computed(() => store.members.find(m => m.id === store.selectedOwnerId))

function firstChar(name: string) { return (name || '物').trim().charAt(0).toUpperCase() }
function quantityText(item: Item) { return item.quantity_text || (item.quantity == null ? '未记录' : `${item.quantity} 个`) }
function formatTime(value?: string | null) { if (!value) return ''; return value.replace('T', ' ').replace(/\.\d+$/, '').slice(0, 16) }
function lifecycleLabel(type?: string | null) { return ({ EXPIRY:'有效期', WARRANTY:'保修', REPLACE:'建议更换', CHECK:'定期检查' } as Record<string,string>)[type || ''] || '生命周期' }

async function runSearch() {
  const q = search.value.trim()
  if (!q) { searchResults.value = []; return }
  try {
    searchResults.value = await api<Item[]>(`/api/items?q=${encodeURIComponent(q)}&owner_id=${store.selectedOwnerId}`)
  } catch (error) { toast((error as Error).message) }
}
function onSearchInput() { window.clearTimeout(searchTimer); searchTimer = window.setTimeout(runSearch, 180) }
function clearSearch() { search.value = ''; searchResults.value = [] }

function openContainerDetail(id: number) { openContainerId.value = id }
function closeContainerDetail() { openContainerId.value = null }

function onItemSaved() { return refreshData() }

function onItemEdit(item: Item) { modals.openEditItem(item) }
function onItemDelete(item: Item) { modals.deleteItem(item, onItemSaved) }

function onHistoryUndo(entry: HistoryEntry) {
  modals.undoHistory(entry, async () => {
    await refreshData()
    if (openContainer.value) await modals.openHistory(openContainer.value)
  })
}

function goAssistant() { router.push({ name: 'assistant' }) }

watch(openContainerId, async (newId, oldId) => {
  if (newId) {
    await nextTick()
    document.body.classList.add('modal-open')
  } else {
    document.body.classList.remove('modal-open')
  }
})
onMounted(() => {
  // 初始时已加载，搜索和滚动条无需重置
})
</script>

<template>
  <div class="view view-inventory active">
    <div class="hero-card home-hero">
      <div class="hero-copy">
        <span class="pill">{{ selectedMember?.name }}的物品</span>
        <h2>家里的东西，按人分清楚。</h2>
        <p>当前版本只区分"我 / 爸 / 妈"，暂不加入具体房间层级。现有数据默认全部归到"我"。</p>
      </div>
      <button class="hero-ai" @click="goAssistant">问 AI <span>→</span></button>
    </div>

    <div class="stats-grid">
      <article class="stat"><span>家庭总物品</span><strong>{{ store.dashboard?.summary.items ?? 0 }}</strong><small>类</small></article>
      <article class="stat"><span>{{ selectedMember?.name }}的箱子</span><strong>{{ filteredContainers.length }}</strong><small>个</small></article>
      <article class="stat warning"><span>30 天内到期</span><strong>{{ store.dashboard?.lifecycle.due30 ?? 0 }}</strong><small>项</small></article>
      <article class="stat danger"><span>已到期</span><strong>{{ store.dashboard?.lifecycle.expired ?? 0 }}</strong><small>项</small></article>
    </div>

    <div class="member-summary-grid">
      <article v-for="m in store.dashboard?.members || []" :key="m.id" class="member-summary" @click="store.setOwner(m.id)">
        <b>{{ m.name }}</b><strong>{{ m.items }}</strong><span>类物品 · {{ m.containers }} 个箱子</span>
      </article>
    </div>

    <div class="toolbar storage-toolbar">
      <label class="search-box">
        <span>⌕</span>
        <input v-model="search" :placeholder="`搜索${selectedMember?.name || ''}的物品、标签、箱子…`" @input="onSearchInput" />
        <kbd>Ctrl K</kbd>
      </label>
      <button class="outline-btn" @click="clearSearch">清除</button>
      <button class="outline-btn" @click="modals.openBatch">批量操作</button>
    </div>

    <section v-if="searching">
      <div class="section-head">
        <div><h3>FTS5 搜索结果</h3><p>{{ searchResults.length }} 条 · 已按"{{ selectedMember?.name }}"范围过滤</p></div>
      </div>
      <RecycleScroller
        v-if="searchResults.length"
        :items="searchResults"
        :item-size="120"
        key-field="id"
        class="virtual-list items-grid"
        v-slot="{ item }">
        <article class="item-card">
          <div class="item-top">
            <div class="item-icon">{{ firstChar(item.name) }}</div>
            <div class="item-actions">
              <button class="icon-btn" @click="onItemEdit(item)">✎</button>
              <button class="icon-btn danger" @click="onItemDelete(item)">×</button>
            </div>
          </div>
          <h4>{{ item.name }}</h4>
          <div class="location">{{ item.owner_name }} · {{ item.container_name }}</div>
          <p v-if="item.notes" class="item-notes">{{ item.notes }}</p>
          <div class="item-meta">
            <span class="chip">{{ quantityText(item) }}</span>
            <span v-if="item.expiry_date" class="chip life">{{ lifecycleLabel(item.lifecycle_type) }} {{ item.expiry_date }}</span>
            <span v-if="item.attachment_count" class="chip">附件 {{ item.attachment_count }}</span>
          </div>
        </article>
      </RecycleScroller>
      <div v-else class="empty">
        <div class="empty-icon">⌕</div>
        <h3>没有匹配</h3>
        <p>可以换关键词，或让 AI 在选定 Scope 中检索。</p>
      </div>
    </section>

    <section v-else>
      <div class="section-head">
        <div><h3>{{ selectedMember?.name }}的箱子</h3><p>点击箱子查看里面的物品；箱子详情里可以打开操作记录。</p></div>
        <button class="outline-btn" @click="modals.openAddContainer">＋ 新建箱子</button>
      </div>
      <RecycleScroller
        v-if="filteredContainers.length"
        :items="filteredContainers"
        :item-size="160"
        key-field="id"
        class="virtual-list containers-grid"
        v-slot="{ item }">
        <article class="container-card" @click="openContainerDetail(item.id)">
          <div class="container-card-top">
            <div class="box-mark">▦</div>
            <span class="owner-badge">{{ item.owner_name }}</span>
          </div>
          <h4>{{ item.name }}</h4>
          <p>{{ item.notes || '收纳位置' }}</p>
          <div class="container-bottom">
            <span>{{ item.item_count }} 类 · 约 {{ item.quantity_sum }} 件/组</span>
            <span>打开 →</span>
          </div>
        </article>
      </RecycleScroller>
      <div v-else class="empty">
        <h3>{{ selectedMember?.name }}还没有箱子</h3>
        <p>先创建箱子，再添加物品。</p>
        <button class="primary-btn" @click="modals.openAddContainer">创建第一个箱子</button>
      </div>
    </section>

    <section class="dashboard-section">
      <div class="section-head">
        <div><h3>最近操作</h3><p>手动、AI、批量操作都会进入历史。</p></div>
      </div>
      <RecycleScroller
        v-if="(store.dashboard?.recent_history || []).length"
        :items="store.dashboard?.recent_history || []"
        :item-size="64"
        key-field="id"
        class="virtual-list history-list compact"
        v-slot="{ item }">
        <article>
          <div>
            <b>{{ item.description }}</b>
            <span>{{ item.source }} · {{ formatTime(item.created_at) }}</span>
          </div>
          <div class="inline-actions">
            <span v-if="item.undone_at" class="undo-state">已撤销</span>
            <button v-else-if="item.can_undo" class="text-btn" @click="onHistoryUndo(item)">撤销</button>
          </div>
        </article>
      </RecycleScroller>
      <p v-else class="muted">暂无记录。</p>
    </section>
  </div>

  <div v-if="openContainer" class="modal-backdrop container-detail-backdrop" @click.self="closeContainerDetail">
    <div class="modal container-detail-modal">
      <div class="container-detail-head">
        <div class="container-detail-title-wrap">
          <div class="box-mark large">▦</div>
          <div>
            <p class="eyebrow">{{ openContainer.owner_name }} / CONTAINER</p>
            <h3>{{ openContainer.name }}</h3>
            <p class="container-detail-note">{{ openContainer.notes || '收纳位置' }}</p>
          </div>
        </div>
        <button class="icon-btn" @click="closeContainerDetail">×</button>
      </div>
      <div class="container-detail-toolbar">
        <span>{{ openContainer.item_count }} 类 · {{ openContainer.quantity_sum }} 件/组</span>
        <div class="inline-actions">
          <button class="outline-btn compact" @click="modals.openHistory(openContainer)">操作记录</button>
          <button class="outline-btn compact" @click="modals.openEditContainer(openContainer)">编辑箱子</button>
          <button class="primary-btn compact" @click="modals.openAddItem(openContainer.id)">＋ 放入物品</button>
        </div>
      </div>
      <div v-if="openContainerItems.length" class="container-detail-items">
        <article v-for="item in openContainerItems" :key="item.id" class="container-item-row">
          <div class="container-item-icon">{{ firstChar(item.name) }}</div>
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
