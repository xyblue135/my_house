<script setup lang="ts">
import { computed, onActivated, onDeactivated, reactive, ref } from 'vue'
import AppIcon from '../components/AppIcon.vue'
import { api } from '../api'
import { useAppStore } from '../store'
import { useToast } from '../composables/useToast'
import type { LifeEntry } from '../types'

const store = useAppStore()
const { toast } = useToast()

const entries = ref<LifeEntry[]>([])
const loading = ref(false)
const formOpen = ref(false)
onDeactivated(() => { formOpen.value = false })
const saving = ref(false)
const entryOwnerId = ref<number | null>(null)

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
  date: localDate(),
})
const editingId = ref<number | null>(null)
function localDate() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function money(value: number) {
  return new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency: 'CNY',
    maximumFractionDigits: 2,
  }).format(Number(value || 0))
}
function monthKey(y: number, m: number) {
  return `${y}-${String(m + 1).padStart(2, '0')}`
}
function dateKey(iso: string) {
  return (iso || '').slice(0, 10)
}

async function load() {
  loading.value = true
  try {
    const [exp, inc] = await Promise.all([
      api<LifeEntry[]>('/api/life?kind=expense&limit=1000&archived=false'),
      api<LifeEntry[]>('/api/life?kind=income&limit=1000&archived=false'),
    ])
    entries.value = [...exp, ...inc].sort((a, b) =>
      (a.occurred_at || a.created_at || '').localeCompare(b.occurred_at || b.created_at || ''),
    )
  } catch (error) {
    toast((error as Error).message)
  } finally {
    loading.value = false
  }
}

// 本月（当前显示月份）汇总
const monthEntries = computed(() => {
  const key = monthKey(year.value, month.value)
  return entries.value.filter((e) => dateKey(e.occurred_at || e.created_at).startsWith(key))
})
const monthIncome = computed(() =>
  monthEntries.value
    .filter((e) => e.kind === 'income')
    .reduce((s, e) => s + Number(e.amount || 0), 0),
)
const monthExpense = computed(() =>
  monthEntries.value
    .filter((e) => e.kind === 'expense')
    .reduce((s, e) => s + Number(e.amount || 0), 0),
)
const monthBalance = computed(() => monthIncome.value - monthExpense.value)

// 日历
const calendarDays = computed(() => {
  const first = new Date(year.value, month.value, 1)
  const startOffset = first.getDay() // 0=Sunday
  const daysInMonth = new Date(year.value, month.value + 1, 0).getDate()
  const cells: { date: string; day: number }[] = []
  for (let i = 0; i < startOffset; i++) cells.push({ date: '', day: 0 })
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({
      date: `${year.value}-${String(month.value + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
      day: d,
    })
  }
  return cells
})
function dayNet(date: string) {
  return monthEntries.value
    .filter((e) => dateKey(e.occurred_at || e.created_at) === date)
    .reduce((s, e) => s + (e.kind === 'income' ? Number(e.amount || 0) : -Number(e.amount || 0)), 0)
}

// 列表（按选中日期过滤）
const listEntries = computed(() => {
  return monthEntries.value
    .filter(
      (e) => !selectedDay.value || dateKey(e.occurred_at || e.created_at) === selectedDay.value,
    )
    .slice()
    .reverse()
})

function prevMonth() {
  if (month.value === 0) {
    month.value = 11
    year.value--
  } else month.value--
  selectedDay.value = null
}
function nextMonth() {
  if (month.value === 11) {
    month.value = 0
    year.value++
  } else month.value++
  selectedDay.value = null
}
function pickDay(date: string) {
  selectedDay.value = selectedDay.value === date ? null : date
}

function resetForm() {
  editingId.value = null
  form.kind = 'expense'
  form.amount = ''
  form.title = ''
  form.category = ''
  form.date = localDate()
  entryOwnerId.value = null
}
function openCreate() {
  resetForm()
  formOpen.value = true
}
function editEntry(e: LifeEntry) {
  entryOwnerId.value = e.owner_id
  formOpen.value = true
  editingId.value = e.id
  form.kind = e.kind === 'income' ? 'income' : 'expense'
  form.amount = e.amount == null ? '' : String(e.amount)
  form.title = e.title
  form.category = e.category || ''
  form.date = dateKey(e.occurred_at || e.created_at)
}
async function save() {
  if (saving.value) return
  const amount = Number(form.amount)
  if (!form.title.trim()) {
    toast('请输入用途')
    return
  }
  if (!amount || amount <= 0) {
    toast('请输入有效金额')
    return
  }
  const payload = {
    kind: form.kind,
    title: form.title.trim(),
    amount,
    category: form.category.trim(),
    occurred_at: form.date,
    status: 'DONE',
    owner_id: entryOwnerId.value ?? store.selectedOwnerId,
  }
  saving.value = true
  try {
    const wasEditing = !!editingId.value
    if (editingId.value)
      await api(`/api/life/${editingId.value}`, { method: 'PATCH', body: JSON.stringify(payload) })
    else await api('/api/life', { method: 'POST', body: JSON.stringify(payload) })
    resetForm()
    formOpen.value = false
    toast(wasEditing ? '已更新' : '已记账')
    await load()
  } catch (error) {
    toast((error as Error).message)
  } finally {
    saving.value = false
  }
}
async function remove(e: LifeEntry) {
  if (!window.confirm(`删除这笔「${e.title}」？`)) return
  try {
    await api(`/api/life/${e.id}`, { method: 'DELETE' })
    await load()
  } catch (error) {
    toast((error as Error).message)
  }
}

onActivated(load)
</script>

<template>
  <section class="view billing-view active">
    <div class="page-heading">
      <div>
        <p class="eyebrow">把每一笔记清楚</p>
        <h1>家庭账本</h1>
        <p class="page-description">日常的收与支，心里有数。</p>
      </div>
      <button class="primary-btn" @click="openCreate"><AppIcon name="plus" />记一笔</button>
    </div>
    <div class="month-picker">
      <button class="icon-btn plain" aria-label="上个月" @click="prevMonth">
        <AppIcon name="left" />
      </button>
      <h2>{{ year }} 年 {{ month + 1 }} 月</h2>
      <button class="icon-btn plain" aria-label="下个月" @click="nextMonth">
        <AppIcon name="right" />
      </button>
    </div>
    <div class="balance-card">
      <span class="balance-label">本月结余</span
      ><strong class="balance-value">{{ money(monthBalance) }}</strong>
      <div class="balance-breakdown">
        <div>
          <span><AppIcon name="lower" :size="15" />收入</span
          ><strong>{{ money(monthIncome) }}</strong>
        </div>
        <div>
          <span><AppIcon name="up" :size="15" />支出</span
          ><strong>{{ money(monthExpense) }}</strong>
        </div>
      </div>
    </div>
    <details class="billing-calendar">
      <summary>
        <span><AppIcon name="calendar" />按日历查看</span><AppIcon name="down" :size="18" />
      </summary>
      <div class="calendar-grid weekday">
        <span v-for="w in ['日', '一', '二', '三', '四', '五', '六']" :key="w">{{ w }}</span>
      </div>
      <div class="calendar-grid">
        <template v-for="(cell, i) in calendarDays" :key="i"
          ><button
            v-if="cell.date"
            class="calendar-cell"
            :class="{ selected: selectedDay === cell.date, today: cell.date === localDate() }"
            :aria-label="cell.date + '，收支净额 ' + money(dayNet(cell.date))"
            :aria-pressed="selectedDay === cell.date"
            @click="pickDay(cell.date)"
          >
            <span class="cal-day">{{ cell.day }}</span
            ><span
              class="cal-net"
              :class="{ neg: dayNet(cell.date) < 0, pos: dayNet(cell.date) > 0 }"
              >{{
                dayNet(cell.date)
                  ? (dayNet(cell.date) > 0 ? '+' : '') + dayNet(cell.date).toFixed(0)
                  : ''
              }}</span
            ></button
          ><span v-else></span
        ></template>
      </div>
    </details>
    <div class="section-head">
      <div>
        <h2>
          {{ selectedDay || '本月明细' }}<span class="count-label">{{ listEntries.length }}</span>
        </h2>
      </div>
      <button v-if="selectedDay" class="text-btn" @click="selectedDay = null">查看整月</button>
    </div>
    <p v-if="loading" class="inline-notice" role="status">正在整理账单…</p>
    <div v-else-if="!listEntries.length" class="empty">
      <AppIcon name="receipt" :size="38" />
      <h3>从记下第一笔开始</h3>
      <p>一顿饭、一份收入，都值得记下来。</p>
      <button class="outline-btn" @click="openCreate">记一笔</button>
    </div>
    <div v-else class="billing-list">
      <article v-for="e in listEntries" :key="e.id" class="billing-row">
        <button
          class="billing-entry-button"
          :aria-label="'编辑账单：' + e.title"
          @click="editEntry(e)"
        >
          <span class="billing-entry-icon" :class="e.kind"
            ><AppIcon :name="e.kind === 'income' ? 'wallet' : 'receipt'" /></span
          ><span class="billing-row-main"
            ><strong>{{ e.title }}</strong
            ><span
              >{{ e.category || '未分类' }} · {{ dateKey(e.occurred_at || e.created_at) }}</span
            ></span
          ><strong class="billing-amount" :class="e.kind"
            >{{ e.kind === 'income' ? '+' : '−' }}{{ money(Number(e.amount || 0)) }}</strong
          >
        </button>
        <button
          class="icon-btn plain danger"
          :aria-label="'删除账单：' + e.title"
          @click="remove(e)"
        >
          <AppIcon name="trash" :size="17" />
        </button>
      </article>
    </div>
  </section>
  <div
    v-if="formOpen"
    v-dialog="() => (formOpen = false)"
    class="modal-backdrop"
    aria-label="记账表单"
    @click.self="formOpen = false"
  >
    <section class="modal small">
      <div class="modal-head">
        <div>
          <p class="eyebrow">家庭账本</p>
          <h2>{{ editingId ? '编辑账单' : '记一笔' }}</h2>
        </div>
        <button class="icon-btn plain" aria-label="关闭记账表单" @click="formOpen = false">
          <AppIcon name="close" />
        </button>
      </div>
      <form class="modal-form one-col" @submit.prevent="save">
        <div class="billing-kind">
          <button
            type="button"
            :class="{ active: form.kind === 'expense' }"
            :aria-pressed="form.kind === 'expense'"
            @click="form.kind = 'expense'"
          >
            支出</button
          ><button
            type="button"
            :class="{ active: form.kind === 'income' }"
            :aria-pressed="form.kind === 'income'"
            @click="form.kind = 'income'"
          >
            收入
          </button>
        </div>
        <label
          >金额（元）<input
            v-model="form.amount"
            class="amount-input"
            type="number"
            inputmode="decimal"
            min="0.01"
            step="0.01"
            required
            placeholder="0.00"
        /></label>
        <label>用途<input v-model="form.title" required placeholder="如：周末买菜" /></label>
        <label>分类<input v-model="form.category" placeholder="如：餐饮、交通、工资" /></label>
        <label>日期<input v-model="form.date" type="date" required /></label>
        <div class="modal-actions">
          <button type="button" class="outline-btn" @click="formOpen = false">取消</button
          ><button class="primary-btn" :disabled="saving">
            {{ saving ? '保存中…' : editingId ? '保存修改' : '记好了' }}
          </button>
        </div>
      </form>
    </section>
  </div>
</template>
