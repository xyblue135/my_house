<script setup lang="ts">
import { onMounted, ref } from 'vue'
import AppIcon from '../components/AppIcon.vue'
import { api, getApiBase, getLanToken, setApiBase, setLanToken } from '../api'
import { useAppStore } from '../store'
import { useToast } from '../composables/useToast'
import { useAppBootstrap } from '../composables/useAppBootstrap'
import type { AiSettings, Member, MqStatus } from '../types'

const store = useAppStore()
const { toast } = useToast()
const { refreshData } = useAppBootstrap()

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
    Object.assign(
      store.aiSettings,
      await api<AiSettings>('/api/settings', { method: 'POST', body: JSON.stringify(payload) }),
    )
    apiKeyInput.value = ''
    settingsSaved.value = true
    toast('AI 设置已保存')
    window.setTimeout(() => {
      settingsSaved.value = false
    }, 1800)
  } catch (error) {
    toast((error as Error).message)
  }
}

function saveBackendUrl() {
  try {
    setApiBase(backendUrlInput.value)
    location.reload()
  } catch (error) {
    toast((error as Error).message)
  }
}

function saveLanToken() {
  setLanToken(lanTokenInput.value || null)
  location.reload()
}

async function refreshMqStatus() {
  try {
    Object.assign(store.mqStatus, await api<MqStatus>('/api/mq/status'))
  } catch (error) {
    toast((error as Error).message)
  }
}

onMounted(async () => {
  try {
    Object.assign(store.aiSettings, await api<AiSettings>('/api/settings'))
  } catch (error) {
    toast((error as Error).message)
  }
  await refreshMqStatus()
})

// ---- 成员管理 ----
const newMemberName = ref('')
async function addMember() {
  const name = newMemberName.value.trim()
  if (!name) {
    toast('请输入成员名称')
    return
  }
  try {
    await api('/api/members', { method: 'POST', body: JSON.stringify({ name }) })
    newMemberName.value = ''
    await refreshData()
    toast('已添加成员')
  } catch (error) {
    toast((error as Error).message)
  }
}
async function renameMember(m: Member) {
  const name = m.name.trim()
  if (!name) {
    toast('成员名称不能为空')
    return
  }
  try {
    await api(`/api/members/${m.id}`, { method: 'PATCH', body: JSON.stringify({ name }) })
    await refreshData()
    toast('已改名')
  } catch (error) {
    toast((error as Error).message)
  }
}
async function deleteMember(m: Member) {
  if (!window.confirm(`删除用户「${m.name}」及其名下所有箱子、物品、记录？此操作不可恢复。`)) return
  try {
    await api(`/api/members/${m.id}`, { method: 'DELETE' })
    await refreshData()
    toast('已删除成员')
  } catch (error) {
    toast((error as Error).message)
  }
}
</script>

<template>
  <div class="view settings-view active">
    <div class="page-heading">
      <div>
        <p class="eyebrow">按家里的习惯来</p>
        <h1>设置</h1>
        <p class="page-description">管理家人，也照顾好你的数据。</p>
      </div>
    </div>
    <div class="settings-card">
      <div class="settings-title">
        <div class="settings-icon"><AppIcon name="users" /></div>
        <div>
          <h3>成员管理</h3>
          <p>在物品页切换成员，查看各自的收纳。删除成员会删除其名下的全部数据。</p>
        </div>
      </div>
      <div class="member-manage-list">
        <div v-for="m in store.members" :key="m.id" class="member-manage-row">
          <input v-model="m.name" :aria-label="'成员名称：' + m.id" @change="renameMember(m)" />
          <button
            class="outline-btn danger-outline"
            :disabled="store.members.length <= 1"
            @click="deleteMember(m)"
          >
            删除
          </button>
        </div>
      </div>
      <div class="member-manage-add">
        <input
          v-model="newMemberName"
          aria-label="新成员名称"
          placeholder="家人的称呼"
          @keyup.enter="addMember"
        />
        <button class="primary-btn" @click="addMember">
          <AppIcon name="plus" :size="17" />添加成员
        </button>
      </div>
    </div>

    <details class="settings-advanced">
      <summary>连接与高级设置<AppIcon name="down" :size="18" /></summary>
      <div class="settings-card">
        <div class="settings-title">
          <div class="settings-icon"><AppIcon name="server" /></div>
          <div>
            <h3>数据服务地址</h3>
            <p>通常无需修改。更换服务器时，填写新的 HTTPS 地址。</p>
          </div>
        </div>
        <form class="settings-form" @submit.prevent="saveBackendUrl">
          <label
            >服务地址<input v-model="backendUrlInput" placeholder="https://items.example.com"
          /></label>
          <div class="settings-actions"><button class="primary-btn">保存并重连</button></div>
        </form>
      </div>

      <div class="settings-card">
        <div class="settings-title">
          <div class="settings-icon"><AppIcon name="key" /></div>
          <div>
            <h3>家庭访问密钥</h3>
            <p>使用家人提供的访问密钥连接服务器。修改后将重新验证连接。</p>
          </div>
        </div>
        <form class="settings-form" @submit.prevent="saveLanToken">
          <label
            >访问密钥<input v-model="lanTokenInput" type="password" autocomplete="current-password"
          /></label>
          <div class="settings-actions"><button class="primary-btn">保存并重连</button></div>
        </form>
      </div>

      <div class="settings-card">
        <div class="settings-title">
          <div class="settings-icon"><AppIcon name="sparkles" /></div>
          <div>
            <h3>AI 接口</h3>
            <p>兼容 OpenAI Chat Completions。</p>
          </div>
        </div>
        <form class="settings-form" @submit.prevent="saveSettings">
          <label>接口地址<input v-model="store.aiSettings.base_url" /></label>
          <label
            >接口密钥
            <div class="password-wrap">
              <input
                v-model="apiKeyInput"
                :type="showApiKey ? 'text' : 'password'"
                placeholder="已保存时无需重复填写"
              />
              <button type="button" @click="showApiKey = !showApiKey">
                {{ showApiKey ? '隐藏' : '显示' }}
              </button>
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
          <div class="settings-icon"><AppIcon name="sparkles" /></div>
          <div>
            <h3>AI 数据边界</h3>
            <p>
              启用 AI
              后，会将相关物品的名称、数量、位置和有效期等文字交给所配置的服务。照片与附件不会发送。
            </p>
          </div>
        </div>
      </div>

      <div class="settings-card">
        <div class="settings-title">
          <div class="settings-icon"><AppIcon name="refresh" /></div>
          <div>
            <h3>RabbitMQ</h3>
            <p>
              {{
                !store.mqStatus.enabled
                  ? '默认禁用'
                  : store.mqStatus.connected
                    ? '已连接'
                    : '未连接，主功能不受影响'
              }}
            </p>
          </div>
        </div>
        <button class="outline-btn" @click="refreshMqStatus">刷新状态</button>
      </div>
    </details>
  </div>
</template>
