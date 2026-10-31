/**
 * 本地 AI：App 直连用户配置的 OpenAI 兼容接口（chat/completions）。
 * 协议与原服务端 AiService 一致：严格 JSON {reply, action}，识别失败降级本地关键词检索。
 * base_url 示例：http://192.168.3.100:31415/v1（网关在电脑上时手机填电脑局域网 IP）
 */
import { state, containerView, itemView, requireContainer, requireItem, nextId, now, logHistory, persist } from './state'

interface AiAction { type: string; item_id?: number; container_id?: number; data?: Record<string, unknown> }
interface ChatResult { reply: string; action: AiAction | null; mode: 'ai' | 'local' }

function context(): string {
  const containers = state.containers.map((c) => {
    const v = containerView(c)
    return `#${c.id} ${c.name}（${v.item_count} 件：${v.item_names ?? '空'}）`
  }).join('\n')
  const items = state.items.map((i) => {
    const v = itemView(i)
    return `#${i.id} ${i.name}（箱子：${v.container_name}${i.quantity != null ? `，${i.quantity} 个` : ''}）`
  }).join('\n')
  const groups = state.groups.map((g) => `#${g.id} ${g.name}`).join('，')
  return `箱子和分组：\n${containers || '（无）'}\n\n分组：${groups || '（无）'}\n\n物品：\n${items || '（无）'}`
}

const SYSTEM_PROMPT = `你是"我的家"家庭物品数据库助手。根据下面的库存上下文回答问题。
修改数据库时只生成一个待确认 action，不能说已经执行。允许的 action：
{"type":"add_item","data":{"name":"...","container_id":1,"quantity":1,"quantity_text":"","condition":"正常","notes":"","tags":""}}
{"type":"move_item","item_id":1,"container_id":2}
{"type":"delete_item","item_id":1}
{"type":"add_container","data":{"name":"...","notes":""}}
任何 action 都必须指向上下文中存在的实体；不确定目标时 action=null 并追问。
严格只输出 JSON：{"reply":"中文回复","action":null或action对象}`

async function callGateway(message: string): Promise<ChatResult> {
  const base = state.ai.base_url.trim().replace(/\/$/, '')
  if (!base) throw new Error('AI 接口地址未配置（设置 → AI 接口）')
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(state.ai.api_key ? { Authorization: `Bearer ${state.ai.api_key}` } : {}),
    },
    body: JSON.stringify({
      model: state.ai.model || 'auto',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT + '\n\n' + context() },
        { role: 'user', content: message },
      ],
    }),
  })
  if (!res.ok) throw new Error(`AI 接口返回 HTTP ${res.status}`)
  const payload = await res.json()
  const content = String(payload?.choices?.[0]?.message?.content ?? '')
  const start = content.indexOf('{')
  const end = content.lastIndexOf('}')
  if (start < 0 || end <= start) return { reply: content.trim(), action: null, mode: 'ai' }
  const parsed = JSON.parse(content.slice(start, end + 1)) as { reply?: string; action?: AiAction | null }
  return { reply: String(parsed.reply ?? ''), action: parsed.action ?? null, mode: 'ai' }
}

function localSearch(message: string): ChatResult {
  const haystack = (i: { name: string; notes: string; tags: string }, containerName: string) =>
    (i.name + ' ' + i.notes + ' ' + i.tags + ' ' + containerName).toLocaleLowerCase()
  const text = message.trim().toLocaleLowerCase()
  // 中文无空格分词：用 2 字滑窗在物品文本里找命中（如「军刀在哪」命中「瑞士军刀」）
  const windows = new Set<string>()
  if (text.length <= 2) windows.add(text)
  for (let i = 0; i + 2 <= text.length; i++) windows.add(text.slice(i, i + 2))
  const hits = state.items.filter((i) => {
    const c = state.containers.find((x) => x.id === i.container_id)
    const hay = haystack(i, c?.name ?? '')
    return [...windows].some((w) => hay.includes(w))
  })
  if (!text || !hits.length) {
    return { reply: '没有找到对应的物品（本地关键词检索）。', action: null, mode: 'local' }
  }
  const lines = hits.slice(0, 10).map((i) => {
    const v = itemView(i)
    return `「${i.name}」在箱子「${v.container_name}」${i.quantity != null ? `（${i.quantity} 个）` : ''}`
  })
  return { reply: `本地检索到 ${hits.length} 件：\n${lines.join('\n')}`, action: null, mode: 'local' }
}

export async function aiChat(message: string): Promise<ChatResult> {
  try {
    const result = await callGateway(message)
    return result
  } catch (error) {
    const fallback = localSearch(message)
    fallback.reply += `\n\nAI 接口调用失败（${(error as Error).message}），已降级到关键词检索。`
    return fallback
  }
}

export function aiExecute(action: AiAction): { reply: string } {
  const data = action.data ?? {}
  switch (action.type) {
    case 'add_item': {
      const name = String(data.name ?? '').trim()
      if (!name) throw new Error('物品名称不能为空')
      const containerId = Number(data.container_id ?? state.containers[0]?.id ?? 0)
      const container = requireContainer(containerId)
      const item = {
        id: nextId(), container_id: container.id, owner_id: container.owner_id, name,
        quantity: data.quantity == null ? null : Number(data.quantity),
        quantity_text: String(data.quantity_text ?? ''), condition: String(data.condition ?? '正常'),
        notes: String(data.notes ?? ''), tags: String(data.tags ?? ''), created_at: now(), updated_at: now(),
      }
      state.items.unshift(item)
      logHistory({
        action_type: 'add', entity_type: 'item', entity_id: item.id, item_id: item.id,
        container_id: container.id, owner_id: item.owner_id, source: 'ai',
        description: `添加物品「${name}」到「${container.name}」`, before: null,
      })
      persist()
      return { reply: `已添加「${name}」到「${container.name}」` }
    }
    case 'move_item': {
      const item = requireItem(Number(action.item_id))
      const target = requireContainer(Number(action.container_id))
      const from = requireContainer(item.container_id)
      const before = { ...item }
      item.container_id = target.id
      item.owner_id = target.owner_id
      item.updated_at = now()
      logHistory({
        action_type: 'update', entity_type: 'item', entity_id: item.id, item_id: item.id,
        container_id: target.id, owner_id: item.owner_id, source: 'ai',
        description: `移动「${item.name}」：${from.name} → ${target.name}`, before,
      })
      persist()
      return { reply: `已把「${item.name}」移到「${target.name}」` }
    }
    case 'delete_item': {
      const item = requireItem(Number(action.item_id))
      const container = requireContainer(item.container_id)
      state.items = state.items.filter((i) => i.id !== item.id)
      logHistory({
        action_type: 'delete', entity_type: 'item', entity_id: item.id, item_id: item.id,
        container_id: container.id, owner_id: item.owner_id, source: 'ai',
        description: `删除物品「${item.name}」`, before: { ...item },
      })
      persist()
      return { reply: `已删除「${item.name}」（可撤销）` }
    }
    case 'add_container': {
      const name = String(data.name ?? '').trim()
      if (!name) throw new Error('箱子名称不能为空')
      if (state.containers.some((c) => c.name === name)) throw new Error(`箱子「${name}」已存在`)
      const container = {
        id: nextId(), name, notes: String(data.notes ?? ''), owner_id: 1, group_id: null,
        pos_x: null, pos_y: null, pos_z: null, size_w: null, size_h: null, size_d: null,
        created_at: now(), updated_at: now(),
      }
      state.containers.unshift(container)
      logHistory({
        action_type: 'add', entity_type: 'container', entity_id: container.id, container_id: container.id,
        owner_id: 1, source: 'ai', description: `新建箱子「${name}」`, before: null,
      })
      persist()
      return { reply: `已新建箱子「${name}」` }
    }
    default:
      throw new Error(`不支持的操作：${action.type}`)
  }
}
