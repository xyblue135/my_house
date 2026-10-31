import { ref } from 'vue'

/**
 * 主搜索的查找范围（在设置页调整，默认全部）。
 * 值：'all' | 'ungrouped' | 分组 id 字符串。房间概念已下线，范围按分组划分。
 */
const STORAGE_KEY = 'myhouse.searchScope'

function load(): string {
  return localStorage.getItem(STORAGE_KEY) || 'all'
}

export const searchScope = ref<string>(load())

export function setSearchScope(value: string): void {
  searchScope.value = value
  try {
    localStorage.setItem(STORAGE_KEY, value)
  } catch {
    /* 存储不可用时仅本次会话生效 */
  }
}

export function scopeLabel(groups: { id: number; name: string }[]): string {
  if (searchScope.value === 'all') return '全部'
  if (searchScope.value === 'ungrouped') return '未分组'
  return groups.find((g) => String(g.id) === searchScope.value)?.name ?? '全部'
}

/** 箱子是否落在当前查找范围内。 */
export function containerInScope(container: { group_id?: number | null }): boolean {
  if (searchScope.value === 'all') return true
  if (searchScope.value === 'ungrouped') return container.group_id == null
  return container.group_id === Number(searchScope.value)
}
