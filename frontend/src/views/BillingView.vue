<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { api } from '../api'
import { useAppStore } from '../store'
import { useToast } from '../composables/useToast'
import type { LifeEntry } from '../types'

const store = useAppStore()
const { toast } = useToast()

const entries = ref<LifeEntry[]>([])
const loading = ref(false)

// 当前显示月份
const now = new Date()
const year = ref(now.getFullYear())
const month = ref(now.getMonth()) // 0-based
const selectedDay = ref<string | null>(null) // 'YYYY-MM-DD'

// 快速记账表单
const form = reactive({
  kind: 'expense' as 'expense' | 'income',
  amount: '',
  title: '',
  category: '',
  date: now.toISOString().slice(0, 10),
})
const editingId = ref<number | null>(null)

function money(value: number) {
  return new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY', maximumFractionDigits: 2 }).format(Number(value || 0))
}
function monthKey(y: number, m: number) { return `${y}-${String(m + 1).padStart(2, '0')}` }
function dateKey(iso: string) { return (iso || '').slice(0, 10) }

async function load() {
  loading.value = true
  try {
    const [exp, inc] = await Promise.all([
      api<LifeEntry[]>('/api/life?kind=expense&limit=1000&archived=false'),
      api<LifeEntry[]>('/api/life?kind=income&limit=1000&archived=false'),
    ])
    entries.value = [...exp, ...inc].sort((a, b) => (a.occurred_at || a.created_at || '').localeCompare(b.occurred_at || b.created_at || ''))
  } catch (error) { toast((error as Error).message) } finally { loading.value = false }
}

// 本月（当前显示月份）汇总
const monthEntries = computed(() => {
  const key = monthKey(year.value, month.value)
  return entries.value.filter(e => dateKey(e.occurred_at || e.created_at).startsWith(key))
})
const monthIncome = computed(() => monthEntries.value.filter(e => e.kind === 'income').reduce((s, e) => s + Number(e.amount || 0), 0))
const monthExpense = computed(() => monthEntries.value.filter(e => e.kind === 'expense').reduce((s, e) => s + Number(e.amount || 0), 0))
const monthBalance = computed(() => monthIncome.value - monthExpense.value)

// 日历
const calendarDays = computed(() => {
  const first = new Date(year.value, month.value, 1)
  const startOffset = first.getDay() // 0=Sunday
  const daysInMonth = new Date(year.value, month.value + 1, 0).getDate()
  const cells: { date: string; day: number }[] = []
  for (let i = 0; i < startOffset; i++) cells.push({ date: '', day: 0 })
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ date: `${year.value}-${String(month.value + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`, day: d })
  }
  return cells
})
function dayNet(date: string) {
  return monthEntries.value.filter(e => dateKey(e.occurred_at || e.created_at) === date)
    .reduce((s, e) => s + (e.kind === 'income' ? Number(e.amount || 0) : -Number(e.amount || 0)), 0)
}

// 列表（按选中日期过滤）
const listEntries = computed(() => {
  const key = monthKey(year.value, month.value)
  return monthEntries.value.filter(e => !selectedDay.value || dateKey(e.occurred_at || e.created_at) === selectedDay.value).slice().reverse()
})

function prevMonth() { if (month.value === 0) { month.value = 11; year.value-- } else month.value--; selectedDay.value = null }
function nextMonth() { if (month.value === 11) { month.value = 0; year.value++ } else month.value++; selectedDay.value = null }
function pickDay(date: string) { selectedDay.value = selectedDay.value === date ? null : date }

function resetForm() {
  editingId.value = null
  form.kind = 'expense'; form.amount = ''; form.title = ''; form.category = ''
  form.date = now.toISOString().slice(0, 10)
}
function editEntry(e: LifeEntry) {
  editingId.value = e.id
  form.kind = (e.kind === 'income' ? 'income' : 'expense')
  form.amount = e.amount == null ? '' : String(e.amount)
  form.title = e.title
  form.category = e.category || ''
  form.date = dateKey(e.occurred_at || e.created_at)
}
async function save() {
  const amount = Number(form.amount)
  if (!form.title.trim()) { toast('请输入用途'); return }
  if (!amount || amount <= 0) { toast('请输入有效金额'); return }
  const payload = {
    kind: form.kind,
    title: form.title.trim(),
    amount,
    category: form.category.trim(),
    occurred_at: form.date,
    status: 'DONE',
    owner_id: store.members[0]?.id ?? 1,
  }
  try {
    if (editingId.value) await api(`/api/life/${editingId.value}`, { method: 'PATCH', body: JSON.stringify(payload) })
    else await api('/api/life', { method: 'POST', body: JSON.stringify(payload) })
    resetForm()
    toast(editingId.value ? '已更新' : '已记账')
    await load()
  } catch (error) { toast((error as Error).message) }
}
async function remove(e: LifeEntry) {
  if (!window.confirm(`删除这笔「${e.title}」？`)) return
  try { await api(`/api/life/${e.id}`, { method: 'DELETE' }); await load() } catch (error) { toast((error as Error).message) }
}

onMounted(load)
</script>

<template>
  <div class="view billing-view active">
    <div class="section-head row-mobile">
      <div>
        <h3>账单中心</h3>
        <p>记录每一笔钱的进出和用途，按月历查看收支。</p>
      </div>
    </div>

    <div class="billing-stats">
      <article class="billing-stat income"><span>本月收入</span><strong>{{ money(monthIncome) }}</strong></article>
      <article class="billing-stat expense"><span>本月支出</span><strong>{{ money(monthExpense) }}</strong></article>
      <article class="billing-stat" :class="{ positive: monthBalance >= 0, negative: monthBalance < 0 }"><span>本月结余</span><strong>{{ money(monthBalance) }}</strong></article>
    </div>

    <form class="billing-form" @submit.prevent="save">
      <div class="billing-kind">
        <button type="button" :class="{ active: form.kind === 'expense' }" @click="form.kind = 'expense'">支出</button>
        <button type="button" :class="{ active: form.kind === 'income' }" @click="form.kind = 'income'">收入</button>
      </div>
      <input v-model="form.amount" type="number" step="0.01" placeholder="金额" />
      <input v-model="form.title" placeholder="用在哪些（用途）" />
      <input v-model="form.category" placeholder="分类（如 餐饮 / 交通 / 工资）" />
      <input v-model="form.date" type="date" />
      <button class="primary-btn">{{ editingId ? '保存修改' : '记账' }}</button>
      <button v-if="editingId" type="button" class="outline-btn" @click="resetForm">取消</button>
    </form>

    <div class="billing-calendar">
      <div class="calendar-head">
        <button class="outline-btn compact" @click="prevMonth">‹ 上月</button>
        <h4>{{ year }} 年 {{ month + 1 }} 月</h4>
        <button class="outline-btn compact" @click="nextMonth">下月 ›</button>
      </div>
      <div class="calendar-grid weekday">
        <span v-for="w in ['日','一','二','三','四','五','六']" :key="w">{{ w }}</span>
      </div>
      <div class="calendar-grid">
        <div v-for="(cell, i) in calendarDays" :key="i" class="calendar-cell" :class="{ empty: !cell.date, selected: selectedDay === cell.date }" @click="cell.date && pickDay(cell.date)">
          <span class="cal-day">{{ cell.day || '' }}</span>
          <span v-if="cell.date" class="cal-net" :class="{ neg: dayNet(cell.date) < 0, pos: dayNet(cell.date) > 0 }">{{ dayNet(cell.date) ? (dayNet(cell.date) > 0 ? '+' : '') + dayNet(cell.date).toFixed(0) : '' }}</span>
        </div>
      </div>
    </div>

    <div class="section-head row-mobile">
      <div><h3>{{ selectedDay || `${month + 1} 月` }} 记录</h3><p>{{ listEntries.length }} 笔</p></div>
      <button v-if="selectedDay" class="outline-btn compact" @click="selectedDay = null">查看整月</button>
    </div>

    <div v-if="loading" class="muted">加载中…</div>
    <div v-else-if="!listEntries.length" class="empty"><h3>还没有记录</h3><p>从上面记一笔开始。</p></div>
    <div v-else class="billing-list">
      <article v-for="e in listEntries" :key="e.id" class="billing-row" :class="e.kind">
        <div class="billing-row-main" @click="editEntry(e)">
          <b>{{ e.title }}</b>
          <span>{{ e.category || '未分类' }} · {{ dateKey(e.occurred_at || e.created_at) }}</span>
        </div>
        <div class="billing-amount" :class="e.kind">{{ e.kind === 'income' ? '+' : '-' }}{{ money(Number(e.amount || 0)) }}</div>
        <button class="icon-btn danger" @click="remove(e)">×</button>
      </article>
    </div>
  </div>
</template>
