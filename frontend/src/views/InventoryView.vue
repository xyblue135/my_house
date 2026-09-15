<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { RecycleScroller } from 'vue-virtual-scroller'
import { api, attachmentUrl } from '../api'
import { useAppStore } from '../store'
import { useToast } from '../composables/useToast'
import { useItemModals } from '../composables/useItemModals'
import { useAppBootstrap } from '../composables/useAppBootstrap'
import { useImagePreview } from '../composables/useImagePreview'
import ContainerDetailModal from '../components/ContainerDetailModal.vue'
import type { HistoryEntry, Item } from '../types'

const store = useAppStore()
const router = useRouter()
const { toast } = useToast()
const modals = useItemModals()
const { refreshData } = useAppBootstrap()
const preview = useImagePreview()

function openCoverPreview(id: number | null | undefined) {
  if (!id) return
  preview.open([attachmentUrl(id)])
}

const search = ref('')
const searchResults = ref<Item[]>([])
let searchTimer: number | undefined
const searching = computed(() => Boolean(search.value.trim()))
const openContainerId = ref<number | null>(null)

const filteredContainers = computed(() => store.containers.filter(c => c.owner_id === store.selectedOwnerId))
const selectedMember = computed(() => store.members.find(m => m.id === store.selectedOwnerId))

// 按箱子聚合物品，正序（后添加的在后），供卡片渲染可点击的小框
const itemsByContainer = computed(() => {
  const map = new Map<number, Item[]>()
  for (const it of store.items) {
    const arr = map.get(it.container_id) ?? []
    arr.push(it)
    map.set(it.container_id, arr)
  }
  for (const arr of map.values()) arr.sort((a, b) => a.id - b.id)
  return map
})
function itemsInContainer(containerId: number): Item[] { return itemsByContainer.value.get(containerId) ?? [] }

function firstChar(name: string) { return (name || '物').trim().charAt(0).toUpperCase() }
function quantityText(item: Item) { return item.quantity == null ? '未记录' : `${item.quantity} 个` }
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
    const c = openContainerId.value == null ? null : store.containers.find(x => x.id === openContainerId.value)
    if (c) await modals.openHistory(c)
  })
}

function goAssistant() { router.push({ name: 'assistant' }) }
</script>

<template>
  <div class="view view-inventory active">
    <div class="hero-card home-hero">
      <div class="hero-copy">
        <span class="pill">{{ selectedMember?.name }}的物品</span>
        <h2>家里的东西，按人分清楚。</h2>
        <p>按用户分开收纳，每个用户还能用分组（如房间A / 房间B）区分盒子的位置。</p>
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
        <input v-model="search" :placeholder="`搜索${selectedMember?.name || ''}的物品、箱子…`" @input="onSearchInput" />
        <kbd>Ctrl K</kbd>
      </label>
      <button class="outline-btn" @click="clearSearch">清除</button>
      <button class="outline-btn" @click="modals.openBatch">批量操作</button>
    </div>

    <section v-if="searching">
      <div class="section-head">
        <div><h3>FTS5 搜索结果</h3><p>{{ searchResults.length }} 条 · 已按"{{ selectedMember?.name }}"范围过滤</p></div>
      </div>
      <div v-if="searchResults.length" class="items-grid">
        <article v-for="item in searchResults" :key="item.id" class="item-card">
          <div class="item-top">
            <div class="item-icon thumb">
              <img v-if="item.cover_attachment_id" :src="attachmentUrl(item.cover_attachment_id)" alt="" loading="lazy" @click.stop="openCoverPreview(item.cover_attachment_id)" />
              <template v-else>{{ firstChar(item.name) }}</template>
            </div>
            <div class="item-actions">
              <button class="icon-btn" @click="onItemEdit(item)">✎</button>
              <button class="icon-btn danger" @click="onItemDelete(item)">×</button>
            </div>
          </div>
          <h4>{{ item.name }}</h4>
          <div class="location">{{ item.owner_name }} · {{ item.container_name }}</div>
          <div class="item-meta">
            <span class="chip">{{ quantityText(item) }}</span>
            <span v-if="item.expiry_date" class="chip life">{{ lifecycleLabel(item.lifecycle_type) }} {{ item.expiry_date }}</span>
            <span v-if="item.attachment_count" class="chip">附件 {{ item.attachment_count }}</span>
          </div>
        </article>
      </div>
      <div v-else class="empty">
        <div class="empty-icon">⌕</div>
        <h3>没有匹配</h3>
        <p>可以换关键词，或让 AI 在选定 Scope 中检索。</p>
      </div>
    </section>

    <section v-else>
      <div class="section-head">
        <div><h3>{{ selectedMember?.name }}的箱子</h3><p>点击箱子查看里面的物品；箱子详情里可以打开操作记录。</p></div>
        <button class="outline-btn" @click="modals.openAddContainer()">＋ 新建箱子</button>
      </div>
      <div v-if="filteredContainers.length" class="containers-grid">
        <article v-for="item in filteredContainers" :key="item.id" class="container-card" @click="openContainerDetail(item.id)">
          <div class="container-cover">
            <img v-if="item.cover_attachment_id" :src="attachmentUrl(item.cover_attachment_id)" alt="" loading="lazy" @click.stop="openCoverPreview(item.cover_attachment_id)" />
            <div v-else class="container-cover-empty">▦</div>
            <span class="owner-badge">{{ item.owner_name }}</span>
          </div>
          <h4>{{ item.name }}</h4>
          <div class="item-chips">
            <button v-for="it in itemsInContainer(item.id)" :key="it.id" class="item-chip" @click.stop="onItemEdit(it)">{{ it.name }}</button>
            <span v-if="!itemsInContainer(item.id).length" class="muted">暂无物品</span>
          </div>
          <p>{{ item.notes || '空备注' }}</p>
          <div class="container-bottom">
            <button class="open-btn" @click.stop="openContainerDetail(item.id)">打开</button>
          </div>
        </article>
      </div>
      <div v-else class="empty">
        <h3>{{ selectedMember?.name }}还没有箱子</h3>
        <p>先创建箱子，再添加物品。</p>
        <button class="primary-btn" @click="modals.openAddContainer()">创建第一个箱子</button>
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

  <ContainerDetailModal :container-id="openContainerId" @close="closeContainerDetail" />
</template>
