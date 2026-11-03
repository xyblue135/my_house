/**
 * 健康记录：体重 + 便便（布里斯托分类可选）。
 * 数据走 state 全套（IndexedDB + 云同步），这里只做增删和派生计算。
 * 注意：state.now() 是 UTC；健康记录用本地时间戳，保证「今天」按手机时区算。
 */
import { state, nextId, persist, type HealthRow } from './state'

export type { HealthRow }

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** 本地时间 'YYYY-MM-DD HH:mm'。 */
export function localStamp(d: Date = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 本地日期 'YYYY-MM-DD'。 */
function dayOffsetKey(base: Date, back: number): string {
  const d = new Date(base)
  d.setDate(d.getDate() - back)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function healthRows(): HealthRow[] {
  return state.health ?? []
}

function sorted(): HealthRow[] {
  // 同一分钟内多条记录时按 id 兜底，保证「最新」稳定
  return [...healthRows()].sort((a, b) => a.at.localeCompare(b.at) || a.id - b.id)
}

export function addHealth(
  input: { type: 'weight' | 'bowel'; kg?: number | null; bristol?: number | null; note?: string; at?: string },
): HealthRow {
  const row: HealthRow = {
    id: nextId(),
    type: input.type,
    at: input.at ?? localStamp(),
    kg: input.type === 'weight' ? Math.round((input.kg ?? 0) * 10) / 10 : null,
    bristol: input.type === 'bowel' ? (input.bristol ?? null) : null,
    note: (input.note ?? '').trim(),
  }
  state.health = [row, ...healthRows()]
  persist()
  return row
}

export function deleteHealth(id: number): void {
  state.health = healthRows().filter((r) => r.id !== id)
  persist()
}

/** 体重序列（旧→新），只含有数值的记录。 */
export function weightSeries(): HealthRow[] {
  return sorted().filter((r) => r.type === 'weight' && r.kg != null)
}

export function bowelRows(): HealthRow[] {
  return sorted().filter((r) => r.type === 'bowel')
}

/** 最新一次体重。 */
export function currentWeight(): HealthRow | null {
  const list = weightSeries()
  return list.length ? list[list.length - 1] : null
}

/** 与上一次的差值（负=轻了）。 */
export function weightDelta(): number | null {
  const list = weightSeries()
  if (list.length < 2) return null
  const a = list[list.length - 1].kg ?? 0
  const b = list[list.length - 2].kg ?? 0
  return Math.round((a - b) * 10) / 10
}

export function bowelByDate(): Map<string, HealthRow[]> {
  const map = new Map<string, HealthRow[]>()
  for (const r of bowelRows()) {
    const key = r.at.slice(0, 10)
    const list = map.get(key) ?? []
    list.push(r)
    map.set(key, list)
  }
  return map
}

/** 今天记了几次。 */
export function bowelCountToday(): number {
  return (bowelByDate().get(dayOffsetKey(new Date(), 0)) ?? []).length
}

/**
 * 连续天数：从今天或昨天往回数连续有记录的天。
 * 今天还没记不算断（昨天连着就继续算），连着漏一天才归零。
 */
export function bowelStreak(): number {
  const days = new Set(bowelByDate().keys())
  const base = new Date()
  let cursor = 0
  if (!days.has(dayOffsetKey(base, 0))) {
    if (!days.has(dayOffsetKey(base, 1))) return 0
    cursor = 1
  }
  let streak = 0
  while (days.has(dayOffsetKey(base, cursor))) {
    streak += 1
    cursor += 1
  }
  return streak
}
