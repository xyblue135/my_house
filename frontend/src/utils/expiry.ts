/**
 * 有效期剩余天数计算。expiry_date 形如 'YYYY-MM-DD'。
 */
export function daysLeft(expiryDate?: string | null): number | null {
  if (!expiryDate) return null
  const d = new Date(expiryDate.slice(0, 10) + 'T00:00:00')
  if (Number.isNaN(d.getTime())) return null
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((d.getTime() - today.getTime()) / 86400000)
}

/** 剩余天数文案：负数 → 已到期 N 天；0 → 今天到期；正数 → 还有 N 天。 */
export function daysLeftText(expiryDate?: string | null): string {
  const n = daysLeft(expiryDate)
  if (n == null) return ''
  if (n < 0) return `已过期 ${-n} 天`
  if (n === 0) return '今天到期'
  return `还有 ${n} 天`
}

/** 短文案（用于 chip / 行内）：-15天 / 15天 / 到期。 */
export function daysLeftShort(expiryDate?: string | null): string {
  const n = daysLeft(expiryDate)
  if (n == null) return ''
  if (n < 0) return `${n} 天`
  if (n === 0) return '到期'
  return `+${n} 天`
}
