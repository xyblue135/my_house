<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { api } from '../api'
import { useAppStore } from '../store'
import type { AiAction, ChatResponse } from '../types'

const store = useAppStore()

interface ChatMessage { id: number; role: 'user'|'assistant'; text: string; action?: AiAction|null; executed?: boolean; error?: string }

const open = ref(false)
const chatMessages = ref<ChatMessage[]>([
  { id: 1, role: 'assistant', text: '你好，我是物栈 AI。我会先按你选的范围在本地数据库检索，再回答或生成待确认操作。图片和附件不会发送给大模型。' },
])
let messageId = 2
const chatInput = ref('')
const chatBusy = ref(false)
const aiOwnerScope = ref<number[]>([store.selectedOwnerId])
const aiLifecycleOnly = ref(false)
const chatSuggestions = ['有哪些东西快到期了？', '哪些物品状态不正常？', '我有哪些箱子？']
const chatList = ref<HTMLElement | null>(null)

// 视角切换被移除后，默认跟随当前选中成员；成员变化时若 scope 空则回退
watch(() => store.selectedOwnerId, (id) => {
  if (!aiOwnerScope.value.includes(id)) aiOwnerScope.value = [id]
})

function togglePanel() { open.value = !open.value; if (open.value) { nextTick(scrollChat) } }

function toggleAiOwner(id: number) {
  aiOwnerScope.value = aiOwnerScope.value.includes(id)
    ? aiOwnerScope.value.filter(x => x !== id)
    : [...aiOwnerScope.value, id]
  if (!aiOwnerScope.value.length) aiOwnerScope.value = [id]
}

function describeAction(action: AiAction) {
  if (action.type === 'add_item') return `新增「${String(action.data?.name || '物品')}」`
  if (action.type === 'update_item') return `修改物品 #${action.item_id}`
  if (action.type === 'move_item') return `移动物品 #${action.item_id} 到箱子 #${action.container_id}`
  if (action.type === 'delete_item') return `删除物品 #${action.item_id}`
  if (action.type === 'add_container') return `新增箱子「${String(action.data?.name || '')}」`
  if (action.type === 'set_lifecycle') return `设置物品 #${action.item_id} 有效期`
  return action.type || '未知操作'
}

async function executeAction(message: ChatMessage) {
  if (!message.action || message.executed) return
  message.error = ''
  try {
    const result = await api<{message: string}>('/api/ai/execute', { method: 'POST', body: JSON.stringify({ action: message.action, owner_ids: aiOwnerScope.value }) })
    message.text = `${message.text}\n\n${result.message}`
    message.executed = true
  } catch (error) { message.error = (error as Error).message }
}

async function sendChat(text = chatInput.value) {
  const value = text.trim()
  if (!value || chatBusy.value) return
  chatMessages.value.push({ id: messageId++, role: 'user', text: value })
  chatInput.value = ''
  chatBusy.value = true
  await nextTick(); scrollChat()
  try {
    const response = await api<ChatResponse>('/api/chat', {
      method: 'POST',
      body: JSON.stringify({ message: value, owner_ids: aiOwnerScope.value, lifecycle_only: aiLifecycleOnly.value }),
    })
    chatMessages.value.push({ id: messageId++, role: 'assistant', text: response.reply || '已处理。', action: response.action })
  } catch (error) {
    chatMessages.value.push({ id: messageId++, role: 'assistant', text: `请求失败：${(error as Error).message}` })
  } finally {
    chatBusy.value = false
    await nextTick(); scrollChat()
  }
}

function scrollChat() {
  if (chatList.value) chatList.value.scrollTop = chatList.value.scrollHeight
}

const showAiModel = computed(() => store.aiSettings.has_api_key ? '大模型 + 本地 FTS5' : '本地 FTS5 检索模式')
</script>

<template>
  <button class="ai-fab" :class="{ active: open }" title="问 AI" @click="togglePanel">
    <span v-if="!open">✦</span><span v-else>✕</span>
  </button>

  <div v-if="open" class="ai-panel">
    <div class="chat-panel">
      <div class="chat-head">
        <div class="ai-avatar">✦</div>
        <div><h3>物栈 AI</h3><p>{{ showAiModel }}</p></div>
      </div>
      <div class="ai-scope">
        <b>查询 / 操作范围</b>
        <div class="scope-buttons">
          <button v-for="m in store.members" :key="m.id" :class="{active:aiOwnerScope.includes(m.id)}" @click="toggleAiOwner(m.id)">{{ m.name }}</button>
          <button :class="{active:aiLifecycleOnly}" @click="aiLifecycleOnly=!aiLifecycleOnly">仅看有效期</button>
        </div>
        <small>范围先在数据库层过滤，再把最多 24 条相关文本候选交给大模型。图片和附件不会进入 AI Context。</small>
      </div>
      <div class="chat-messages" ref="chatList">
        <div v-for="message in chatMessages" :key="message.id" class="message" :class="message.role">
          <div class="bubble">
            {{ message.text }}
            <div v-if="message.action && !message.executed" class="action-card">
              <p>待确认：{{ describeAction(message.action) }}</p>
              <p v-if="message.error" class="action-error">{{ message.error }}</p>
              <button @click="executeAction(message)">确认执行</button>
            </div>
          </div>
        </div>
        <div v-if="chatBusy" class="message assistant">
          <div class="bubble typing-dots"><span>.</span><span>.</span><span>.</span></div>
        </div>
      </div>
      <div class="suggestions">
        <button v-for="s in chatSuggestions" :key="s" @click="sendChat(s)">{{ s }}</button>
      </div>
      <form class="chat-input-wrap" @submit.prevent="sendChat()">
        <textarea v-model="chatInput" rows="1" placeholder="例如：哪些东西快到期了？" @keydown.enter.exact.prevent="sendChat()"></textarea>
        <button type="submit" class="send-btn">↑</button>
      </form>
    </div>
  </div>
</template>
