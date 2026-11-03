import { beforeEach, describe, expect, it } from 'vitest'
import { freshState, state } from '../src/local/state'
import { localApi } from '../src/local/localApi'
import { validateAction } from '../src/local/ai'
import type { Container } from '../src/types'

function reset() {
  Object.assign(state, freshState())
}

async function createContainer(name: string): Promise<Container> {
  return await localApi({ method: 'POST', path: '/api/containers', query: new URLSearchParams(), body: { name, owner_id: 1 }, form: null })
}

describe('local data layer', () => {
  beforeEach(reset)

  it('creates containers and groups, computes counts', async () => {
    const group = await localApi({ method: 'POST', path: '/api/groups', query: new URLSearchParams(), body: { owner_id: 1, name: '轩' }, form: null })
    await createContainer('主板箱子')
    await createContainer('耳机盒子')
    const containers = await localApi({ method: 'GET', path: '/api/containers', query: new URLSearchParams(), body: null, form: null }) as Container[]
    expect(containers).toHaveLength(2)
    expect(containers[0].group_name).toBeNull()

    await localApi({ method: 'PATCH', path: `/api/containers/${containers[0].id}`, query: new URLSearchParams(), body: { group_id: (group as { id: number }).id }, form: null })
    const updated = await localApi({ method: 'GET', path: '/api/containers', query: new URLSearchParams(), body: null, form: null }) as Container[]
    expect(updated.find((c) => c.name === '主板箱子')?.group_name).toBe('轩')
  })

  it('items CRUD, search and delete guard', async () => {
    const container = await createContainer('常用盒子')
    const containerId = (container as { id: number }).id
    const item = await localApi({ method: 'POST', path: '/api/items', query: new URLSearchParams(), body: { container_id: containerId, name: '螺丝刀', quantity: 3 }, form: null }) as { id: number }
    await localApi({ method: 'POST', path: '/api/items', query: new URLSearchParams(), body: { container_id: containerId, name: '充电线' }, form: null })

    const found = await localApi({ method: 'GET', path: '/api/items', query: new URLSearchParams({ q: '螺丝' }), body: null, form: null }) as { id: number }[]
    expect(found.map((i) => i.id)).toContain(item.id)

    await expect(localApi({ method: 'DELETE', path: `/api/containers/${containerId}`, query: new URLSearchParams(), body: null, form: null }))
      .rejects.toThrow('该箱子里还有物品')

    await localApi({ method: 'DELETE', path: `/api/items/${item.id}`, query: new URLSearchParams(), body: null, form: null })
    const after = await localApi({ method: 'GET', path: '/api/items', query: new URLSearchParams({ q: '螺丝' }), body: null, form: null }) as unknown[]
    expect(after).toHaveLength(0)
  })

  it('history undo restores a deleted item', async () => {
    const container = await createContainer('历史盒子')
    const containerId = (container as { id: number }).id
    const item = await localApi({ method: 'POST', path: '/api/items', query: new URLSearchParams(), body: { container_id: containerId, name: '待删物品' }, form: null }) as { id: number }
    await localApi({ method: 'DELETE', path: `/api/items/${item.id}`, query: new URLSearchParams(), body: null, form: null })

    const history = await localApi({ method: 'GET', path: '/api/history', query: new URLSearchParams({ container_id: String(containerId) }), body: null, form: null }) as { id: number; can_undo: boolean; undone_at: string | null }[]
    const del = history.find((h) => h.action_type === 'delete')
    expect(del).toBeTruthy()

    await localApi({ method: 'POST', path: `/api/history/${del!.id}/undo`, query: new URLSearchParams(), body: null, form: null })
    const restored = await localApi({ method: 'GET', path: '/api/items', query: new URLSearchParams(), body: null, form: null }) as { name: string }[]
    expect(restored.some((i) => i.name === '待删物品')).toBe(true)
  })

  it('ai execute adds, moves and deletes items with history', async () => {
    const container = await createContainer('AI 测试箱')
    const containerId = (container as { id: number }).id
    const target = await createContainer('目标箱')
    const targetId = (target as { id: number }).id

    const add = await localApi({ method: 'POST', path: '/api/ai/execute', query: new URLSearchParams(), body: { action: { type: 'add_item', data: { name: '闪存盘', container_id: containerId, quantity: 2 } } }, form: null }) as { reply: string }
    expect(add.reply).toContain('闪存盘')
    const item = state.items.find((i) => i.name === '闪存盘')
    expect(item?.container_id).toBe(containerId)

    const move = await localApi({ method: 'POST', path: '/api/ai/execute', query: new URLSearchParams(), body: { action: { type: 'move_item', item_id: item!.id, container_id: targetId } }, form: null }) as { reply: string }
    expect(move.reply).toContain('目标箱')

    const del = await localApi({ method: 'POST', path: '/api/ai/execute', query: new URLSearchParams(), body: { action: { type: 'delete_item', item_id: item!.id } }, form: null }) as { reply: string }
    expect(del.reply).toContain('可撤销')
    expect(state.items.some((i) => i.id === item!.id)).toBe(false)
  })

  it('ai chat falls back to local keyword search', { timeout: 10000 }, async () => {
    // 清空网关地址：强制走本地降级（CI 环境无网关）
    state.ai.base_url = ''
    const container = await createContainer('检索箱')
    const containerId = (container as { id: number }).id
    await localApi({ method: 'POST', path: '/api/items', query: new URLSearchParams(), body: { container_id: containerId, name: '瑞士军刀' }, form: null })
    const result = await localApi({ method: 'POST', path: '/api/ai/chat', query: new URLSearchParams(), body: { message: '军刀在哪', owner_ids: [1] }, form: null }) as { mode: string; reply: string }
    expect(result.mode).toBe('local')
    expect(result.reply).toContain('瑞士军刀')
  })
})

describe('validateAction（AI 输出格式校验）', () => {
  beforeEach(() => { Object.assign(state, freshState()) })

  it('拒绝未知类型与缺失名称', () => {
    expect(() => localApi && undefined).not.toThrow()
expect(() => validateAction({ type: 'teleport' })).toThrow('未知的操作类型')
    expect(() => validateAction({ type: 'add_item', data: { name: '  ' } })).toThrow('缺少物品名称')
    expect(() => validateAction({ type: 'add_item', data: { name: '手办' } })).toThrow('不存在')
  })

  it('合法 action 通过校验', () => {
// 先造一个箱子
    state.containers.unshift({ id: 1, name: '轩', notes: '', owner_id: 1, group_id: null, pos_x: null, pos_y: null, pos_z: null, size_w: null, size_h: null, size_d: null, created_at: '', updated_at: '' })
    const a = validateAction({ type: 'add_item', data: { name: '手办', container_id: 1 } })
    expect(a.data?.name).toBe('手办')
  })
})

describe('health records', () => {
  beforeEach(reset)

  it('records weight and bowel, keeps latest stable with same-minute timestamps', async () => {
    const { addHealth, currentWeight, weightDelta, bowelStreak, bowelCountToday } = await import('../src/local/health')
    addHealth({ type: 'weight', kg: 72.5, at: '2026-11-03 09:00' })
    addHealth({ type: 'weight', kg: 71.8, at: '2026-11-03 09:00' }) // 同一分钟两条
    addHealth({ type: 'bowel', at: '2026-11-03 09:10' })
    addHealth({ type: 'bowel', bristol: 4, note: '完美', at: '2026-11-02 20:00' })
    expect(currentWeight()?.kg).toBe(71.8) // id 更大的是最新
    expect(weightDelta()).toBe(-0.7)
    expect(bowelCountToday()).toBe(1)
    expect(bowelStreak()).toBe(2) // 今天 + 昨天
  })

  it('streak breaks after a missed day but survives an unrecorded today', async () => {
    const { addHealth, bowelStreak } = await import('../src/local/health')
    const day = (back: number, hour = '08:00') => {
      const d = new Date()
      d.setDate(d.getDate() - back)
      const p = (n: number) => String(n).padStart(2, '0')
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${hour}`
    }
    addHealth({ type: 'bowel', at: day(1) })
    addHealth({ type: 'bowel', at: day(2) })
    expect(bowelStreak()).toBe(2) // 今天没记不断签
    addHealth({ type: 'bowel', at: day(4) })
    expect(bowelStreak()).toBe(2) // 漏了昨天？不：昨天和前天连续，day4 不影响
    addHealth({ type: 'bowel', at: day(0) })
    expect(bowelStreak()).toBe(3) // 今天 + 昨 + 前
  })
})
