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
}

const chatMessages = ref<ChatMessage[]>([])
const chatBusy = ref(false)
const executing = ref(false)
const busy = computed(() => chatBusy.value || executing.value)
const chatList = ref<HTMLElement | null>(null)
const chatSuggestions = ['耳机', '哪些物品状态不正常？', '我有哪些箱子？']
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
  message.error = ''
  message.executing = true
  executing.value = true
  try {
    const result = await api<{ message: string }>('/api/ai/execute', {
      method: 'POST',
      body: JSON.stringify({ action: message.action, owner_ids: message.ownerIds }),
    })
    message.text += '\n\n' + result.message
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

defineExpose({ sendChat })
</script>

<template>
  <section class="ai-inline-results" aria-label="AI 查找结果" :aria-busy="busy">
    <div class="chat-head">
      <div class="ai-avatar"><AppIcon name="sparkles" /></div>
      <div>
        <h3>AI 查找</h3>
        <p>在上方输入要找的物品或整理要求，修改前会请你确认。</p>
      </div>
      <button v-if="chatMessages.length" class="text-btn" :disabled="busy" @click="reset">清空</button>
    </div>
    <div v-if="chatMessages.length || chatBusy" ref="chatList" class="chat-messages" role="log" aria-live="polite" aria-label="AI 回复">
      <div v-for="message in chatMessages" :key="message.id" class="message" :class="message.role">
        <div class="bubble">
          {{ message.text }}
          <div v-if="message.action && !message.executed" class="action-card">
            <p>待确认：{{ describeAction(message.action) }}</p>
            <p class="muted">操作范围：{{ message.scopeLabel }}</p>
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