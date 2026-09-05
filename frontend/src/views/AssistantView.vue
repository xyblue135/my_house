<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { api } from '../api'
import { useAppStore } from '../store'
import type { AiAction, ChatResponse } from '../types'

const store = useAppStore()

interface ChatMessage { id: number; role: 'user'|'assistant'; text: string; action?: AiAction|null; executed?: boolean; error?: string }

const chatMessages = ref<ChatMessage[]>([
  { id: 1, role: 'assistant', text: '你好。我会先按你选择的"我 / 爸 / 妈 / 生命周期"范围在本地数据库检索，再回答或生成待确认操作。图片和附件暂时不会发送给大模型。' },
])
let messageId = 2
const chatInput = ref('')
const chatBusy = ref(false)
const aiOwnerScope = ref<number[]>([1])
const aiLifecycleOnly = ref(false)
const chatSuggestions = ['HDMI 相关的东西在哪里？', '哪些东西快到期了？', '有哪些物品状态不正常？']
const chatList = ref<HTMLElement | null>(null)

function toggleAiOwner(id: number) {
  aiOwnerScope.value = aiOwnerScope.value.includes(id)
    ? aiOwnerScope.value.filter(x => x !== id)
    : [...aiOwnerScope.value, id]
  if (!aiOwnerScope.value.length) aiOwnerScope.value = [id]
}

function describeAction(action: AiAction) {
  if (action.type === 'add_item') return `新增"${String(action.data?.name || '物品')}"`
  if (action.type === 'update_item') return `修改物品 #${action.item_id}`
  if (action.type === 'move_item') return `移动物品 #${action.item_id} 到箱子 #${action.container_id}`
  if (action.type === 'delete_item') return `删除物品 #${action.item_id}`
  if (action.type === 'add_container') return `新增箱子"${String(action.data?.name || '')}"`
  if (action.type === 'set_lifecycle') return `设置物品 #${action.item_id} 生命周期`
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

const showAiModel = computed(() => store.aiSettings.has_api_key ? '大模型 + 本地 FTS5' : '本地 FTS5 模式')
</script>

<template>
  <div class="view assistant-layout active">
    <div class="chat-panel">
      <div class="chat-head">
        <div class="ai-avatar">✦</div>
        <div><h3>物栈 AI</h3><p>{{ showAiModel }}</p></div>
      </div>
      <div class="ai-scope">
        <b>查询 / 操作范围</b>
        <div class="scope-buttons">
          <button v-for="m in store.members" :key="m.id" :class="{active:aiOwnerScope.includes(m.id)}" @click="toggleAiOwner(m.id)">{{ m.name }}</button>
          <button :class="{active:aiLifecycleOnly}" @click="aiLifecycleOnly=!aiLifecycleOnly">生命周期物品</button>
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
        <textarea v-model="chatInput" rows="1" placeholder="例如：爸的 CR2032 电池什么时候该换？" @keydown.enter.exact.prevent="sendChat()"></textarea>
        <button type="submit" class="send-btn">↑</button>
      </form>
      <p class="chat-hint">语音输入暂未实现。后续方案：本地 Whisper / faster-whisper → 文本 → 当前 Agent，不改变数据库工具层。</p>
    </div>
    <aside class="assistant-side">
      <h4>当前 Agent 能做</h4>
      <div class="prompt-card"><span>⌕</span><div><b>本地检索</b><p>FTS5 先查，再交给模型。</p></div></div>
      <div class="prompt-card"><span>⇄</span><div><b>数据库操作</b><p>添加、修改、移动、删除、生命周期。</p></div></div>
      <div class="prompt-card"><span>◉</span><div><b>Scope 隔离</b><p>我 / 爸 / 妈 / 生命周期可组合。</p></div></div>
      <div class="side-note">附件只保存在本地，不喂给当前大语言模型。</div>
    </aside>
  </div>
</template>
