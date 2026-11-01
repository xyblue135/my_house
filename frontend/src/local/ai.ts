/**
 * 本地 AI：App 直连用户配置的 OpenAI 兼容接口（chat/completions）。
 * 两条通道严格分离：
 *  - aiChat（查找）：只读问答，绝不生成修改指令；失败降级本地关键词检索
 *  - aiPlanAction（整理）：生成待确认操作，严格格式校验 + 失败自动重试，
 *    校验通过后仍需用户在确认卡里核对归属与内容才会执行
 */
import { Capacitor, CapacitorHttp } from '@capacitor/core'
import { state, containerView, itemView, requireContainer, requireItem, nextId, now, logHistory, persist } from './state'
import { setLight } from './statusLights'

const isNative = Capacitor.isNativePlatform()
let lastRawOutput = ''

/** 网关请求：App 内走原生 HTTP（绕过 WebView 的 CORS 与混合内容限制），网页走 fetch。 */
async function gatewayRequest(path: string, init: { method: string; jsonBody?: unknown }): Promise<{ status: number; data: any }> {
  const base = state.ai.base_url.trim().replace(/\/$/, '')
  const url = `${base}${path}`
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (state.ai.api_key) headers.Authorization = `Bearer ${state.ai.api_key}`
  try {
    let res: { status: number; data: any }
    if (isNative) {
      const r = await CapacitorHttp.request({
        url, method: init.method, headers,
        data: init.jsonBody ?? undefined,
        responseType: 'json',
        readTimeout: 120000, connectTimeout: 15000,
      })
      res = { status: r.status, data: r.data }
    } else {
      const r = await fetch(url, {
        method: init.method, headers,
        body: init.jsonBody ? JSON.stringify(init.jsonBody) : undefined,
      })
      const text = await r.text()
      let data: unknown = text
      try { data = JSON.parse(text) } catch { /* 保留原文 */ }
      res = { status: r.status, data }
    }
    setLight('ai', res.status >= 200 && res.status < 300 ? 'ok' : 'fail')
    return res
  } catch (error) {
    setLight('ai', 'fail')
    throw error
  }
}

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

const READ_PROMPT = `你是"我的家"家庭物品查询助手。只根据下面的库存上下文回答**查找类**问题（物品在哪、有什么、数量多少）。
你是只读的：绝不生成任何修改指令，绝不输出 JSON 指令；用户要求修改/整理/移动时，
回复引导他使用「AI 整理」入口来执行。`

const ACTION_PROMPT = `你是"我的家"家庭物品数据库助手。根据下面的库存上下文，把用户的整理指令解析成一个待确认操作。
修改数据库时只生成一个待确认 action，不能说已经执行。允许的 action：
{"type":"add_item","data":{"name":"...","container_id":1,"quantity":1,"quantity_text":"","condition":"正常","notes":"","tags":""}}
{"type":"move_item","item_id":1,"container_id":2}
{"type":"delete_item","item_id":1}
{"type":"add_container","data":{"name":"...","notes":""}}
规则：
- 物品已存在（看物品清单）→ move_item；不存在 → add_item
- 任何 action 都必须指向上下文中存在的实体 id；不确定目标时 action=null 并在 reply 里追问
严格只输出 JSON：{"reply":"中文回复","action":null或action对象}`

/** 严格校验 AI 输出的 action：类型、必填字段、实体存在性。失败抛出具体原因。 */
export function validateAction(raw: unknown): AiAction {
  const a = raw as AiAction
  if (!a || typeof a !== 'object' || Array.isArray(a)) throw new Error('输出必须是 JSON 对象')
  const type = String(a.type ?? '')
  const allowed = ['add_item', 'move_item', 'delete_item', 'add_container']
  if (!allowed.includes(type)) throw new Error(`未知的操作类型「${type || '空'}」，允许：${allowed.join('、')}`)
  if (type === 'move_item' || type === 'delete_item') {
    const item = state.items.find((i) => i.id === Number(a.item_id))
    if (!item) throw new Error(`item_id ${a.item_id} 在库存中不存在`)
  }
  if (type === 'move_item') requireContainer(Number(a.container_id))
  if (type === 'add_item') {
    if (!String(a.data?.name ?? '').trim()) throw new Error('add_item 缺少物品名称 data.name')
    requireContainer(Number(a.data?.container_id))
  }
  if (type === 'add_container') {
    if (!String(a.data?.name ?? '').trim()) throw new Error('add_container 缺少箱子名称 data.name')
  }
  return {
    type,
    item_id: a.item_id == null ? undefined : Number(a.item_id),
    container_id: a.container_id == null ? undefined : Number(a.container_id),
    data: (a.data ?? {}) as Record<string, unknown>,
  }
}

function extractJson(content: string): unknown {
  const start = content.indexOf('{')
  const end = content.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('回复中没有找到 JSON')
  return JSON.parse(content.slice(start, end + 1))
}

/** 查找（只读）：失败降级本地关键词检索。 */
async function callGatewayReadonly(message: string): Promise<ChatResult> {
  if (!state.ai.base_url.trim()) throw new Error('AI 接口地址未配置（设置 → AI 接口）')
  const res = await gatewayRequest('/chat/completions', {
    method: 'POST',
    jsonBody: {
      model: state.ai.model || 'auto',
      messages: [
        { role: 'system', content: READ_PROMPT + '\n\n' + context() },
        { role: 'user', content: message },
      ],
    },
  })
  if (res.status < 200 || res.status >= 300) throw new Error(`AI 接口返回 HTTP ${res.status}`)
  const payload = res.data as Record<string, any>
  return { reply: String(payload?.choices?.[0]?.message?.content ?? '').trim(), action: null, mode: 'ai' }
}

function localSearch(message: string): ChatResult {
  const hay = (i: { name: string; notes: string; tags: string }, containerName: string) =>
    (i.name + ' ' + i.notes + ' ' + i.tags + ' ' + containerName).toLocaleLowerCase()
  const text = message.trim().toLocaleLowerCase()
  // 中文无空格分词：用 2 字滑窗在物品文本里找命中（如「军刀在哪」命中「瑞士军刀」）
  const windows = new Set<string>()
  if (text.length <= 2) windows.add(text)
  for (let i = 0; i + 2 <= text.length; i++) windows.add(text.slice(i, i + 2))
  const hits = state.items.filter((i) => {
    const c = state.containers.find((x) => x.id === i.container_id)
    const h = hay(i, c?.name ?? '')
    return [...windows].some((w) => h.includes(w))
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
    if (!state.ai.base_url.trim()) return localSearch(message)
    const res = await callGatewayReadonly(message)
    return res.reply ? res : localSearch(message)
  } catch (error) {
    const fallback = localSearch(message)
    fallback.reply += `\n\nAI 接口调用失败（${(error as Error).message}），已降级到关键词检索。`
    return fallback
  }
}

export interface PlannedAction { reply: string; action: AiAction; attempts: number }

/**
 * 整理指令 → 待确认操作。
 * 严格校验 + 自动重试：模型输出不合格时，把具体错误回传给模型修正，
 * 最多 3 次；仍失败则抛错（用户可换个说法重试）。
 */
export async function aiPlanAction(message: string, onAttempt?: (attempt: number, error: string) => void): Promise<PlannedAction> {
  if (!state.ai.base_url.trim()) throw new Error('AI 接口地址未配置（设置 → AI 接口）')
  const messages: { role: string; content: string }[] = [
    { role: 'system', content: ACTION_PROMPT + '\n\n' + context() },
    { role: 'user', content: message },
  ]
  let lastError = ''
  const attempts = 3
  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (attempt > 1) {
      messages.push({ role: 'assistant', content: lastRawOutput || '' })
      messages.push({ role: 'user', content: `你的输出无效：${lastError}。请修正后严格只输出 {"reply":"...","action":{...}} 格式的 JSON。` })
    }
    onAttempt?.(attempt, lastError)
    const res = await gatewayRequest('/chat/completions', {
      method: 'POST',
      jsonBody: { model: state.ai.model || 'auto', messages },
    })
    if (res.status < 200 || res.status >= 300) throw new Error(`AI 接口返回 HTTP ${res.status}`)
    const payload = res.data as Record<string, any>
    const content = String(payload?.choices?.[0]?.message?.content ?? '')
    lastRawOutput = content
    let parsed: { reply?: string; action?: unknown }
    try {
      parsed = extractJson(content) as { reply?: string; action?: unknown }
    } catch {
      lastError = '回复不是有效的 JSON'
      lastRawOutput = content
      continue
    }
    try {
      const action = validateAction(parsed.action)
      return { reply: String(parsed.reply ?? ''), action, attempts: attempt }
    } catch (error) {
      lastError = (error as Error).message
      lastRawOutput = content
    }
  }
  throw new Error(`AI 连续 ${attempts} 次未能生成有效操作（${lastError}），请换个说法重试`)
}


/** 执行已确认的操作（写库 + 历史，可撤销）。 */
export function aiExecute(action: AiAction): { reply: string } {
  const data = action.data ?? {}
  switch (action.type) {
    case 'add_item': {
      const name = String(data.name ?? '').trim()
      if (!name) throw new Error('物品名称不能为空')
      const container = requireContainer(Number(data.container_id))
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

/** AI 连接测试：GET /models，返回人类可读结果。 */
export async function aiTest(): Promise<string> {
  if (!state.ai.base_url.trim()) return '✗ AI 接口地址未配置'
  try {
    const res = await gatewayRequest('/models', { method: 'GET' })
    if (res.status === 401 || res.status === 403) return '✗ 网关可达，但密钥无效或未填写'
    if (res.status < 200 || res.status >= 300) return `✗ 网关返回 HTTP ${res.status}`
    const models = (res.data as Record<string, unknown>)?.data
    const count = Array.isArray(models) ? models.length : 0
    return count ? `✓ 网关可达，${count} 个模型可用` : '✓ 网关可达'
  } catch (error) {
    return `✗ ${(error as Error).message || '连接失败'}`
  }
}
