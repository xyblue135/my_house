<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onDeactivated, ref, watch } from 'vue'
import AppIcon from './AppIcon.vue'
import { useAppBootstrap } from '../composables/useAppBootstrap'
import { api } from '../api'
import { useAppStore } from '../store'
import type { AiAction, ChatResponse } from '../types'

const props = defineProps<{ ownerIds: number[]; scopeLabel: string }>()
const emit = defineEmits<{ busy: [value: boolean]; suggestion: [text: string] }>()
const store = useAppStore()
const { refreshData } = useAppBootstrap()

interface ChatMessage {
  id: number
  role: 'user' | 'assistant'
  text: string
  ownerIds: number[]
  scopeLabel: string
  action?: AiAction | null
  executed?: boolean
  executing?: boolean
  error?: string
  attempts?: number
  /** 用户在确认卡里可调整的字段（归属箱子/名称/数量） */
  edit?: { name?: string; container_id?: number; quantity?: number | null }
}

const chatMessages = ref<ChatMessage[]>([])
const chatBusy = ref(false)
const executing = ref(false)
const busy = computed(() => chatBusy.value || executing.value || planning.value)
const chatList = ref<HTMLElement | null>(null)
const chatSuggestions = ['耳机', '哪些物品状态不正常？', '我有哪些箱子？']
// AI 整理：与查找分离的写操作入口（格式校验 → 自动重试 → 用户确认卡）
const planning = ref(false)

function editOf(message: ChatMessage) {
  if (!message.edit) {
    message.edit = {}
    if (message.action?.type === 'add_item') {
      message.edit.name = String(message.action.data?.name ?? '')
      message.edit.container_id = message.action.data?.container_id != null
        ? Number(message.action.data.container_id) : undefined
      message.edit.quantity = message.action.data?.quantity != null ? Number(message.action.data.quantity) : null
    }
    if (message.action?.type === 'move_item' && message.action.container_id != null) {
      message.edit.container_id = Number(message.action.container_id)
    }
  }
  return message.edit
}

async function planAndConfirm(text?: string) {
  const value = (text ?? '').trim()
  if (!value || planning.value || busy.value) return
  const ownerIds = [...props.ownerIds]
  const scopeLabel = props.scopeLabel
  planning.value = true
  try {
    const plan = await api<{ reply: string; action: AiAction | null; attempts: number }>('/api/ai/plan', {
      method: 'POST',
      body: JSON.stringify({ message: value, owner_ids: ownerIds }),
      timeoutMs: 55000,
    })
    chatMessages.value.push({ id: messageId++, role: 'user', text: `〔整理〕${value}`, ownerIds, scopeLabel })
    const message: ChatMessage = {
      id: messageId++, role: 'assistant', text: plan.reply || '已解析。', ownerIds, scopeLabel,
      action: plan.action, attempts: plan.attempts,
    }
    if (plan.action) editOf(message)
    chatMessages.value.push(message)
  } catch (error) {
    chatMessages.value.push({ id: messageId++, role: 'assistant', text: `解析失败：${(error as Error).message}`, ownerIds, scopeLabel })
  } finally {
    planning.value = false
    await nextTick()
    scrollChat()
  }
}
let messageId = 1
let generation = 0
let request: AbortController | null = null

watch(busy, value => emit('busy', value), { flush: 'sync' })
watch(() => props.ownerIds.join(','), reset)
onBeforeUnmount(reset)
onDeactivated(reset)

function reset() {
  generation++
  request?.abort()
  request = null
  chatBusy.value = false
  chatMessages.value = []
}

function describeAction(action: AiAction) {
  const itemName = store.items.find(item => item.id === action.item_id)?.name || '物品 #' + action.item_id
  const boxName = store.containers.find(box => box.id === action.container_id)?.name || '箱子 #' + action.container_id
  if (action.type === 'add_item') return '新增「' + String(action.data?.name || '物品') + '」'
  if (action.type === 'update_item') return '修改「' + itemName + '」'
  if (action.type === 'move_item') return '把「' + itemName + '」移到「' + boxName + '」'
  if (action.type === 'delete_item') return '删除「' + itemName + '」'
  if (action.type === 'add_container') return '新增箱子「' + String(action.data?.name || '') + '」'
  return action.type || '未知操作'
}

async function executeAction(message: ChatMessage) {
  if (!message.action || message.executed || busy.value) return
  // 人工确认环节：用户可修改归属箱子与物品内容，这里合并回 action
  const action = { ...message.action, data: { ...(message.action.data ?? {}) } }
  const edit = message.edit
  if (edit) {
    if (action.type === 'add_item') {
      if (edit.name != null) action.data.name = edit.name
      if (edit.container_id != null) action.data.container_id = edit.container_id
      if (edit.quantity != null) action.data.quantity = edit.quantity
    }
    if (action.type === 'move_item' && edit.container_id != null) action.container_id = edit.container_id
    if (action.type === 'add_container' && edit.name != null) action.data.name = edit.name
    if ((action.type === 'add_item' || action.type === 'add_container') && !String(action.data.name ?? '').trim()) {
      message.error = '名称不能为空'
      return
    }
    if (action.type === 'add_item' && action.data.container_id == null) {
      message.error = '请选择放入的箱子'
      return
    }
  }
  message.error = ''
  message.executing = true
  executing.value = true
  try {
    const result = await api<{ reply?: string; message?: string }>('/api/ai/execute', {
      method: 'POST',
      body: JSON.stringify({ action, owner_ids: message.ownerIds }),
    })
    message.text += '\n\n' + (result.reply ?? result.message ?? '已执行。')
    message.executed = true
    await refreshData()
  } catch (error) {
    message.error = (error as Error).message
  } finally {
    message.executing = false
    executing.value = false
  }
}

async function sendChat(text: string) {
  const value = text.trim()
  if (!value || busy.value) return
  const ownerIds = [...props.ownerIds]
  const scopeLabel = props.scopeLabel
  const currentGeneration = generation
  const controller = new AbortController()
  request = controller
  chatMessages.value.push({ id: messageId++, role: 'user', text: value, ownerIds, scopeLabel })
  chatBusy.value = true
  await nextTick()
  scrollChat()
  try {
    const response = await api<ChatResponse>('/api/chat', {
      method: 'POST',
      body: JSON.stringify({ message: value, owner_ids: ownerIds }),
      timeoutMs: 55000,
      signal: controller.signal,
    })
    if (currentGeneration !== generation) return
    chatMessages.value.push({
      id: messageId++, role: 'assistant', text: response.reply || '已处理。',
      action: response.action, ownerIds, scopeLabel,
    })
  } catch (error) {
    if (currentGeneration !== generation) return
    chatMessages.value.push({ id: messageId++, role: 'assistant', text: '请求失败：' + (error as Error).message, ownerIds, scopeLabel })
  } finally {
    if (currentGeneration === generation) {
      chatBusy.value = false
      request = null
      await nextTick()
      scrollChat()
    }
  }
}

function scrollChat() {
  if (chatList.value) chatList.value.scrollTop = chatList.value.scrollHeight
}

defineExpose({ sendChat, planAndConfirm })
</script>

<template>
  <section class="ai-inline-results" aria-label="AI 查找结果" :aria-busy="busy">
    <div class="chat-head">
      <div class="ai-avatar"><AppIcon name="sparkles" /></div>
      <div>
        <h3>AI 查找</h3>
        <p>查找用上方搜索框（只读）；整理指令在搜索框下方一栏，确认后才会生效。</p>
      </div>
      <button v-if="chatMessages.length" class="text-btn" :disabled="busy" @click="reset">清空</button>
    </div>
    <div v-if="chatMessages.length || chatBusy" ref="chatList" class="chat-messages" role="log" aria-live="polite" aria-label="AI 回复">
      <div v-for="message in chatMessages" :key="message.id" class="message" :class="message.role">
        <div class="bubble">
          {{ message.text }}
          <div v-if="message.action && !message.executed" class="action-card">
            <p>待确认：{{ describeAction(message.action) }}</p>
            <p class="muted">操作范围：{{ message.scopeLabel }} · 解析尝试 {{ message.attempts ?? 1 }} 次</p>
            <div v-if="message.action.type === 'add_item'" class="action-fields">
              <label>物品名称<input v-model="editOf(message).name" /></label>
              <label>放入箱子<select v-model="editOf(message).container_id">
                <option v-for="c in store.containers" :key="c.id" :value="c.id">{{ c.name }}</option>
              </select></label>
              <label>数量<input type="number" min="1" v-model.number="editOf(message).quantity" /></label>
            </div>
            <div v-else-if="message.action.type === 'move_item'" class="action-fields">
              <label>移入箱子<select v-model="editOf(message).container_id">
                <option v-for="c in store.containers" :key="c.id" :value="c.id">{{ c.name }}</option>
              </select></label>
            </div>
            <p v-if="message.error" class="action-error" role="alert">{{ message.error }}</p>
            <button :disabled="busy" @click="executeAction(message)">{{ message.executing ? '执行中…' : '确认执行' }}</button>
          </div>
        </div>
      </div>
      <div v-if="chatBusy" class="message assistant"><div class="bubble" role="status">正在查找…</div></div>
    </div>
    <div v-else class="suggestions">
      <button v-for="suggestion in chatSuggestions" :key="suggestion" @click="emit('suggestion', suggestion)">{{ suggestion }}</button>
    </div>
  </section>
</template>