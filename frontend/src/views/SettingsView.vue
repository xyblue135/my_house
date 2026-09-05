<script setup lang="ts">
import { ref } from 'vue'
import { api, getApiBase, getLanToken, setApiBase, setLanToken } from '../api'
import { useAppStore } from '../store'
import { useToast } from '../composables/useToast'
import type { AiSettings, MqStatus } from '../types'

const store = useAppStore()
const { toast } = useToast()

const apiKeyInput = ref('')
const showApiKey = ref(false)
const settingsSaved = ref(false)
const backendUrlInput = ref(getApiBase())
const lanTokenInput = ref(getLanToken() || '')

async function saveSettings() {
  const payload: Record<string, string> = {
    base_url: store.aiSettings.base_url.trim(),
    model: store.aiSettings.model.trim() || 'auto',
  }
  if (apiKeyInput.value.trim()) payload.api_key = apiKeyInput.value.trim()
  try {
    Object.assign(store.aiSettings, await api<AiSettings>('/api/settings', { method: 'POST', body: JSON.stringify(payload) }))
    apiKeyInput.value = ''
    settingsSaved.value = true
    toast('AI 设置已保存')
    window.setTimeout(() => { settingsSaved.value = false }, 1800)
  } catch (error) { toast((error as Error).message) }
}

function saveBackendUrl() {
  setApiBase(backendUrlInput.value)
  toast('服务地址已保存，正在重新连接')
  window.setTimeout(() => location.reload(), 500)
}

function saveLanToken() {
  setLanToken(lanTokenInput.value || null)
  toast(lanTokenInput.value ? '局域网 token 已保存' : '已清除局域网 token')
}

async function refreshMqStatus() {
  try { Object.assign(store.mqStatus, await api<MqStatus>('/api/mq/status')) }
  catch (error) { toast((error as Error).message) }
}
</script>

<template>
  <div class="view active">
    <div class="settings-card">
      <div class="settings-title">
        <div class="settings-icon">API</div>
        <div>
          <h3>数据服务地址</h3>
          <p>Web 同机使用空值；Android 模拟器通常使用 http://10.0.2.2:8765，真机填写电脑或 NAS 的局域网地址。</p>
        </div>
      </div>
      <form class="settings-form" @submit.prevent="saveBackendUrl">
        <label>Backend URL<input v-model="backendUrlInput" placeholder="留空表示与页面同源" /></label>
        <div class="settings-actions"><button class="primary-btn">保存并重连</button></div>
      </form>
    </div>

    <div class="settings-card">
      <div class="settings-title">
        <div class="settings-icon">LAN</div>
        <div>
          <h3>局域网 token</h3>
          <p>仅在 <code>ITEMNEST_BIND_ADDRESS</code> 不为 127.0.0.1 时由后端强制要求。值由后端环境变量 <code>ITEMNEST_LAN_TOKEN</code> 设置。</p>
        </div>
      </div>
      <form class="settings-form" @submit.prevent="saveLanToken">
        <label>Token<input v-model="lanTokenInput" placeholder="与后端 ITEMNEST_LAN_TOKEN 一致" /></label>
        <div class="settings-actions"><button class="primary-btn">保存 token</button></div>
      </form>
    </div>

    <div class="settings-card">
      <div class="settings-title">
        <div class="settings-icon">AI</div>
        <div>
          <h3>AI 接口</h3>
          <p>兼容 OpenAI Chat Completions。</p>
        </div>
      </div>
      <form class="settings-form" @submit.prevent="saveSettings">
        <label>Base URL<input v-model="store.aiSettings.base_url" /></label>
        <label>API Key
          <div class="password-wrap">
            <input v-model="apiKeyInput" :type="showApiKey ? 'text' : 'password'" placeholder="已保存时无需重复填写" />
            <button type="button" @click="showApiKey = !showApiKey">{{ showApiKey ? '隐藏' : '显示' }}</button>
          </div>
        </label>
        <label>模型<input v-model="store.aiSettings.model" /></label>
        <div class="settings-actions">
          <button class="primary-btn">保存设置</button>
          <span v-if="settingsSaved">已保存</span>
        </div>
      </form>
    </div>

    <div class="settings-card">
      <div class="settings-title">
        <div class="settings-icon">AI</div>
        <div>
          <h3>AI 数据边界</h3>
          <p>当前版本只发送文本字段：名称、数量、成员、箱子、状态、备注、标签和生命周期。图片、附件内容、Base64、文件路径均不会发送给大模型。</p>
        </div>
      </div>
    </div>

    <div class="settings-card">
      <div class="settings-title">
        <div class="settings-icon">MQ</div>
        <div>
          <h3>RabbitMQ</h3>
          <p>{{ !store.mqStatus.enabled ? '默认禁用' : store.mqStatus.connected ? '已连接' : '未连接，主功能不受影响' }}</p>
        </div>
      </div>
      <button class="outline-btn" @click="refreshMqStatus">刷新状态</button>
    </div>
  </div>
</template>
