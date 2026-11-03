<script setup lang="ts">
import { computed, nextTick, onActivated, ref, watch } from 'vue'
import AppIcon from '../components/AppIcon.vue'
import { useToast } from '../composables/useToast'
import {
  addHealth, deleteHealth, healthRows, currentWeight, bowelByDate, bowelStreak,
  bowelCountToday, localStamp, type HealthRow,
} from '../local/health'

const { toast } = useToast()

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

// state 非响应式，这里持快照，增删后 reload
const rows = ref<HealthRow[]>([])
function reload() {
  rows.value = [...healthRows()]
}
onActivated(reload)
reload()

const weightList = computed(() =>
  rows.value
    .filter((r) => r.type === 'weight' && r.kg != null)
    .sort((a, b) => a.at.localeCompare(b.at) || a.id - b.id),
)
const currentKg = computed(() => {
  const list = weightList.value
  return list.length ? list[list.length - 1].kg : null
})
const delta = computed(() => {
  const list = weightList.value
  if (list.length < 2) return null
  return Math.round(((list[list.length - 1].kg ?? 0) - (list[list.length - 2].kg ?? 0)) * 10) / 10
})
/** 差值按当前单位显示（斤 = kg×2） */
const deltaDisplay = computed(() => {
  if (delta.value == null) return null
  return unit.value === 'jin' ? Math.round(delta.value * 2 * 10) / 10 : delta.value
})

// ---- 体重记录：底部输入条 ----
const weightSheetOpen = ref(false)
const weightInput = ref('')
const weightSaving = ref(false)
const saveTick = ref(0)

// ---- 单位：kg / 斤（只影响显示与输入，存储永远是 kg） ----
const UNIT_KEY = 'myhouse.weightUnit'
const unit = ref<'kg' | 'jin'>((localStorage.getItem(UNIT_KEY) as 'kg' | 'jin') || 'kg')
const unitLabel = computed(() => (unit.value === 'jin' ? '斤' : 'kg'))
function setUnit(next: 'kg' | 'jin') {
  if (unit.value === next) return
  unit.value = next
  localStorage.setItem(UNIT_KEY, next)
  if (weightSheetOpen.value) openWeightSheet() // 按新单位重新预填
}
/** kg → 当前单位的显示字符串（一位小数） */
function fmtKg(kg: number | null | undefined): string {
  if (kg == null) return '--'
  return (unit.value === 'jin' ? kg * 2 : kg).toFixed(1)
}
function openWeightSheet() {
  // 预填上一次的体重（当前单位），输入条里用 ± 步进微调即可
  weightInput.value = currentKg.value != null ? fmtKg(currentKg.value) : ''
  weightSheetOpen.value = true
}
function adjustWeight(step: number) {
  const cur = Number(weightInput.value || '0') || 0
  weightInput.value = Math.max(0, cur + step).toFixed(1)
}
function saveWeight() {
  // v-model 可能给数字也可能给字符串，统一按字符串解析
  const text = String(weightInput.value ?? '').trim()
  const v = Number(text)
  if (!text || !isFinite(v) || v <= 0) {
    toast('请输入合理的数值')
    return
  }
  // 斤 → kg（保留两位）；kg 保留一位，存储统一为公斤
  const kg = unit.value === 'jin' ? Math.round((v / 2) * 100) / 100 : Math.round(v * 10) / 10
  if (kg < 20 || kg > 300) {
    toast('请输入合理的体重（20 ~ 300 kg，即 40 ~ 600 斤）')
    return
  }
  addHealth({ type: 'weight', kg })
  reload()
  weightSheetOpen.value = false
  saveTick.value++
  toast('已记录，继续保持 👍')
}

// ---- 体重小秤：指针弹簧式摆到当前值 ----
const needleDeg = ref(-70)
const gaugeRange = computed(() => {
  const vals = weightList.value.map((r) => r.kg ?? 0)
  if (!vals.length) return { lo: 50, hi: 90 }
  let lo = Math.min(...vals) - 2
  let hi = Math.max(...vals) + 2
  if (hi - lo < 4) { lo -= 2; hi += 2 }
  return { lo, hi }
})
watch([currentKg, saveTick], async () => {
  const c = currentKg.value
  needleDeg.value = -70
  await nextTick()
  await new Promise((r) => setTimeout(r, 40))
  if (c == null) { needleDeg.value = 0; return }
  const { lo, hi } = gaugeRange.value
  needleDeg.value = -70 + ((c - lo) / (hi - lo)) * 140
}, { immediate: true })

// ---- 近 30 次迷你曲线（划入动画） ----
const spark = computed(() => {
  const list = weightList.value.slice(-30)
  if (list.length < 2) return null
  const w = 300, h = 84, px = 6, py = 12
  const vals = list.map((r) => r.kg ?? 0)
  let min = Math.min(...vals), max = Math.max(...vals)
  if (max - min < 1) { min -= 0.5; max += 0.5 }
  const x = (i: number) => px + (i / (list.length - 1)) * (w - px * 2)
  const y = (v: number) => h - py - ((v - min) / (max - min)) * (h - py * 2)
  const pts = list.map((r, i) => `${x(i).toFixed(1)},${y(r.kg ?? 0).toFixed(1)}`)
  return {
    w, h,
    line: pts.join(' '),
    area: `M${px},${h - py} L${pts.join(' L')} L${w - px},${h - py} Z`,
    lastX: x(list.length - 1), lastY: y(vals[vals.length - 1]),
  }
})

// ---- 便便 ----
const BRISTOL = [
  { n: 1, face: '😣', label: '颗粒硬球' },
  { n: 2, face: '😟', label: '疙瘩香肠' },
  { n: 3, face: '🙂', label: '裂纹香肠' },
  { n: 4, face: '😄', label: '光滑香蕉' },
  { n: 5, face: '🍮', label: '软块断边' },
  { n: 6, face: '🥣', label: '糊状' },
  { n: 7, face: '💦', label: '水状' },
]
function bristolMeta(n: number | null) {
  return BRISTOL.find((b) => b.n === n) ?? null
}
const poopTick = ref(0)
const bristolOpen = ref(false)
const bristolSel = ref<number | null>(null)
const bowelNote = ref('')
const bowelTodayN = computed(() => bowelCountToday())
const streak = computed(() => bowelStreak())
const bowelMap = computed(() => bowelByDate())

function recordBowel(bristol: number | null, note = '') {
  addHealth({ type: 'bowel', bristol, note })
  reload()
  poopTick.value++
  if (bristol === 3 || bristol === 4) toast('形状完美 👌 已记一笔')
  else toast('已记录，一路顺畅')
}
function saveBowelDetail() {
  recordBowel(bristolSel.value, bowelNote.value)
  bristolSel.value = null
  bowelNote.value = ''
  bristolOpen.value = false
}
function sparkStyle(i: number): Record<string, string> {
  const angles = [-90, -40, 10, 55, -140, 175]
  const a = ((angles[i % 6] ?? 0) * Math.PI) / 180
  const dist = 30 + (i % 3) * 12
  return {
    '--dx': `${Math.cos(a) * dist}px`,
    '--dy': `${Math.sin(a) * dist}px`,
    animationDelay: `${i * 25}ms`,
  }
}

// ---- 回看：月导航 + 三个视图 ----
const curMonth = localStamp().slice(0, 7)
const tab = ref<'chart' | 'calendar' | 'list'>('chart')
const month = ref(curMonth)
const monthLabel = computed(() => {
  const [y, m] = month.value.split('-').map(Number)
  return `${y} 年 ${m} 月`
})
function monthShift(dir: number) {
  const [y, m] = month.value.split('-').map(Number)
  const d = new Date(y, m - 1 + dir, 1)
  const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
  if (key > curMonth) return
  month.value = key
}
const monthWeights = computed(() => weightList.value.filter((r) => r.at.slice(0, 7) === month.value))
const monthChart = computed(() => {
  const list = monthWeights.value
  if (list.length < 2) return null
  const w = 316, h = 150, px = 26, py = 22
  const vals = list.map((r) => r.kg ?? 0)
  let min = Math.min(...vals), max = Math.max(...vals)
  if (max - min < 1) { min -= 0.5; max += 0.5 }
  const x = (i: number) => px + (i / (list.length - 1)) * (w - px * 2)
  const y = (v: number) => h - py - ((v - min) / (max - min)) * (h - py * 2)
  const pts = list.map((r, i) => ({ cx: x(i), cy: y(r.kg ?? 0), v: r.kg ?? 0, day: r.at.slice(8, 10) }))
  return {
    w, h, min, max,
    line: pts.map((p) => `${p.cx.toFixed(1)},${p.cy.toFixed(1)}`).join(' '),
    area: `M${px},${h - py} L${pts.map((p) => `${p.cx.toFixed(1)},${p.cy.toFixed(1)}`).join(' L')} L${w - px},${h - py} Z`,
    pts,
  }
})
const calendarCells = computed(() => {
  const [y, m] = month.value.split('-').map(Number)
  const lead = (new Date(y, m - 1, 1).getDay() + 6) % 7 // 周一开头
  const daysInMonth = new Date(y, m, 0).getDate()
  const today = localStamp().slice(0, 10)
  const cells: { key: string; day: number | null; count: number; isToday: boolean }[] = []
  for (let i = 0; i < lead; i++) cells.push({ key: `lead-${i}`, day: null, count: 0, isToday: false })
  for (let d = 1; d <= daysInMonth; d++) {
    const key = `${month.value}-${pad(d)}`
    cells.push({ key, day: d, count: bowelMap.value.get(key)?.length ?? 0, isToday: key === today })
  }
  return cells
})
const listRows = computed(() => [...rows.value].sort((a, b) => b.at.localeCompare(a.at) || b.id - a.id))
function rowMain(r: HealthRow): string {
  if (r.type === 'weight') return `${fmtKg(r.kg)} ${unitLabel.value}`
  const meta = bristolMeta(r.bristol)
  return meta ? `便便 · ${meta.face} ${meta.label}` : '便便 · 随手一笔'
}
function removeRow(r: HealthRow) {
  if (!window.confirm('删除这条记录？')) return
  deleteHealth(r.id)
  reload()
  toast('已删除')
}
</script>

<template>
  <div class="view health-view active">
    <div class="page-heading">
      <div>
        <p class="eyebrow">身体也是家的一部分</p>
        <h1>健康</h1>
        <p class="page-description">称一称，记一笔，顺顺当当每一天。</p>
      </div>
    </div>

    <!-- 体重 -->
    <section class="health-card weight-card">
      <div class="health-card-head">
        <h3><AppIcon name="scale" :size="18" /> 体重</h3>
        <div class="head-actions">
          <div class="unit-seg" role="group" aria-label="体重单位">
            <button :class="{ on: unit === 'kg' }" @click="setUnit('kg')">kg</button>
            <button :class="{ on: unit === 'jin' }" @click="setUnit('jin')">斤</button>
          </div>
          <button class="outline-btn compact" @click="openWeightSheet">记录</button>
        </div>
      </div>
      <div class="weight-row">
        <svg class="weight-gauge" viewBox="0 0 120 70" aria-hidden="true">
          <defs>
            <linearGradient id="hg-arc" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stop-color="#a8bda8" />
              <stop offset="1" stop-color="#285f4e" />
            </linearGradient>
          </defs>
          <path d="M16 62 A44 44 0 0 1 104 62" stroke="#e7ece4" stroke-width="9" fill="none" stroke-linecap="round" />
          <path d="M16 62 A44 44 0 0 1 104 62" stroke="url(#hg-arc)" stroke-width="9" fill="none" stroke-linecap="round" opacity="0.45" />
          <g transform="translate(60,62)">
            <g class="needle" :style="{ transform: `rotate(${needleDeg}deg)` }">
              <line x1="0" y1="0" x2="0" y2="-34" stroke="#285f4e" stroke-width="4" stroke-linecap="round" />
            </g>
          </g>
          <circle cx="60" cy="62" r="6" fill="#285f4e" />
        </svg>
        <div class="weight-num-block" :key="saveTick">
          <div class="weight-num">
            <span class="num-roll">{{ fmtKg(currentKg) }}</span><small>{{ unitLabel }}</small>
          </div>
          <span v-if="delta != null" class="weight-delta" :class="{ down: delta < 0, up: delta > 0 }">
            {{ delta > 0 ? '↑' : delta < 0 ? '↓' : '－' }} {{ Math.abs(deltaDisplay ?? 0) }} {{ unitLabel }} 较上次
          </span>
          <span v-else class="weight-delta idle">记两次就能看变化</span>
        </div>
      </div>
      <svg v-if="spark" class="weight-spark" :viewBox="`0 0 ${spark.w} ${spark.h}`" aria-hidden="true">
        <path class="spark-area" :d="spark.area" fill="#285f4e" opacity="0.08" />
        <path
          class="spark-line" :key="'sp' + saveTick" :d="`M${spark.line}`" pathLength="1"
          fill="none" stroke="#285f4e" stroke-width="2.5" stroke-linecap="round"
        />
        <circle :cx="spark.lastX" :cy="spark.lastY" r="4" fill="#285f4e" />
        <circle class="spark-dot-pulse" :cx="spark.lastX" :cy="spark.lastY" r="7" fill="#285f4e" opacity="0.25" />
      </svg>
      <p v-else class="health-hint">先记两次体重，这里长出一条小曲线。</p>
    </section>

    <!-- 便便 -->
    <section class="health-card bowel-card">
      <div class="health-card-head">
        <h3>今天便便了吗？</h3>
        <span v-if="streak > 0" class="streak" :class="{ hot: streak >= 3, king: streak >= 7 }">
          <AppIcon name="flame" :size="14" />已连续 {{ streak }} 天
          <AppIcon v-if="streak >= 7" name="crown" :size="15" />
        </span>
      </div>
      <div class="bowel-row">
        <div class="poop-wrap">
          <div v-if="poopTick" :key="'burst' + poopTick" class="poop-burst" aria-hidden="true">
            <span v-for="i in 6" :key="i" class="spark" :style="sparkStyle(i)">✦</span>
          </div>
          <button class="poop-btn" :key="'p' + poopTick" :class="{ done: bowelTodayN > 0 }" @click="recordBowel(null)">
            <span class="poop-emoji">💩</span>
            <span class="poop-label">{{ bowelTodayN ? '再来一次' : '顺畅一把' }}</span>
          </button>
        </div>
        <div class="bowel-status">
          <p v-if="bowelTodayN" class="bowel-state ok">今天已顺畅 ✓ <b>{{ bowelTodayN }}</b> 次</p>
          <p v-else class="bowel-state">今天还没有记录，点一下就好。</p>
          <button class="text-btn detail-toggle" @click="bristolOpen = !bristolOpen">
            {{ bristolOpen ? '收起' : '认真记一笔（形状 / 备注）' }}
          </button>
        </div>
      </div>
      <div v-if="bristolOpen" class="bowel-detail">
        <div class="bristol-grid">
          <button
            v-for="b in BRISTOL" :key="b.n" class="bristol-item"
            :class="{ sel: bristolSel === b.n, perfect: b.n === 3 || b.n === 4 }"
            @click="bristolSel = b.n"
          >
            <span class="bristol-face">{{ b.face }}</span>
            <span class="bristol-label">{{ b.label }}</span>
            <span class="bristol-n">{{ b.n }}</span>
          </button>
        </div>
        <input v-model="bowelNote" class="bowel-note" type="text" maxlength="50" placeholder="备注（可选）：比如很通畅 / 吃了辣" />
        <div class="settings-actions">
          <button class="primary-btn compact" @click="saveBowelDetail">记这一笔</button>
        </div>
      </div>
    </section>

    <!-- 回看 -->
    <section class="health-card history-card">
      <div class="seg-tabs" role="tablist">
        <button :class="{ active: tab === 'chart' }" @click="tab = 'chart'">体重曲线</button>
        <button :class="{ active: tab === 'calendar' }" @click="tab = 'calendar'">便便日历</button>
        <button :class="{ active: tab === 'list' }" @click="tab = 'list'">列表</button>
      </div>

      <div v-if="tab !== 'list'" class="month-nav">
        <button class="month-btn" aria-label="上个月" @click="monthShift(-1)">‹</button>
        <b>{{ monthLabel }}</b>
        <button class="month-btn" :disabled="month >= curMonth" aria-label="下个月" @click="monthShift(1)">›</button>
      </div>

      <template v-if="tab === 'chart'">
        <svg v-if="monthChart" class="month-chart" :viewBox="`0 0 ${monthChart.w} ${monthChart.h}`">
          <path :d="monthChart.area" fill="#285f4e" opacity="0.07" />
          <path :d="`M${monthChart.line}`" fill="none" stroke="#285f4e" stroke-width="2.5" stroke-linecap="round" />
          <g v-for="p in monthChart.pts" :key="p.day + '-' + p.v">
            <circle :cx="p.cx" :cy="p.cy" r="3.5" fill="#285f4e" />
            <text :x="p.cx" :y="p.cy - 9" text-anchor="middle" class="chart-val">{{ unit === 'jin' ? (p.v * 2).toFixed(1) : p.v }}</text>
          </g>
        </svg>
        <p v-else class="health-hint">这个月体重记录还不到两次，先去上面记一笔。</p>
      </template>

      <template v-else-if="tab === 'calendar'">
        <div class="cal-week">
          <span v-for="w in ['一', '二', '三', '四', '五', '六', '日']" :key="w">{{ w }}</span>
        </div>
        <div class="cal-grid">
          <span
            v-for="(c, i) in calendarCells" :key="c.key" class="cal-cell"
            :class="{ empty: !c.day, filled: c.count > 0, hot: c.count > 1, today: c.isToday }"
            :style="{ animationDelay: `${Math.min(i * 14, 420)}ms` }"
          >
            <b v-if="c.day">{{ c.day }}</b>
            <i v-if="c.count > 0">💩</i>
          </span>
        </div>
        <p class="health-hint cal-hint">绿格子 = 当天有记录，颜色越深次数越多。</p>
      </template>

      <template v-else>
        <div v-if="listRows.length" class="health-list">
          <article v-for="r in listRows" :key="r.id" class="health-list-row">
            <span class="hl-icon" :class="r.type">{{ r.type === 'weight' ? '⚖' : '💩' }}</span>
            <div class="hl-copy">
              <b>{{ rowMain(r) }}</b>
              <span>{{ r.at }}<template v-if="r.note"> · {{ r.note }}</template></span>
            </div>
            <button class="icon-btn plain danger" aria-label="删除这条记录" @click="removeRow(r)">
              <AppIcon name="trash" :size="17" />
            </button>
          </article>
        </div>
        <p v-else class="health-hint">还没有任何记录，从上面两张卡开始。</p>
      </template>
    </section>

    <!-- 体重输入条 -->
    <div v-if="weightSheetOpen" class="sheet-backdrop" @click.self="weightSheetOpen = false">
      <div class="sheet">
        <h3>记录体重 <small class="sheet-sub">在上次基础上微调</small></h3>
        <div class="sheet-input">
          <input
            v-model="weightInput" type="text" inputmode="decimal"
            :placeholder="unit === 'jin' ? '145.0' : '72.5'" @keydown.enter.prevent="saveWeight"
          />
          <span class="sheet-unit">{{ unitLabel }}</span>
        </div>
        <div class="sheet-steps">
          <button class="step-btn" type="button" aria-label="减 1" @click="adjustWeight(-1)">−1</button>
          <button class="step-btn" type="button" aria-label="减 0.5" @click="adjustWeight(-0.5)">−0.5</button>
          <button class="step-btn" type="button" aria-label="减 0.1" @click="adjustWeight(-0.1)">−0.1</button>
        </div>
        <div class="sheet-steps">
          <button class="step-btn plus" type="button" aria-label="加 0.1" @click="adjustWeight(0.1)">+0.1</button>
          <button class="step-btn plus" type="button" aria-label="加 0.5" @click="adjustWeight(0.5)">+0.5</button>
          <button class="step-btn plus" type="button" aria-label="加 1" @click="adjustWeight(1)">+1</button>
        </div>
        <div class="settings-actions">
          <button class="primary-btn" :disabled="weightSaving" @click="saveWeight">保存</button>
          <button class="outline-btn" @click="weightSheetOpen = false">取消</button>
        </div>
      </div>
    </div>
  </div>
</template>
