<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import AppIcon from '../components/AppIcon.vue'
import { api, getApiBase, setApiBase, setSessionToken } from '../api'
import { useAppStore } from '../store'
import { useToast } from '../composables/useToast'
import { searchScope, setSearchScope } from '../composables/useSearchScope'
import {
  cloudConfig, cloudBusy, cloudMessage, lastBackupTime,
  saveCloudConfig, backupToCloud, restoreFromCloud, type CloudConfig,
} from '../composables/useCloudBackup'
import {
  ttsEnabled, ttsCustomOn, ttsCustomUrl, ttsCustomKey,
  setTtsEnabled, setTtsCustomOn, setTtsCustomUrl, setTtsCustomKey, speak,
} from '../composables/useSpeech'
import type { AiSettings, MqStatus } from '../types'

const store = useAppStore()
const { toast } = useToast()

const apiKeyInput = ref('')
const showApiKey = ref(false)
const settingsSaved = ref(false)
const backendUrlInput = ref(getApiBase())

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

function logout() {
  setSessionToken(null)
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

// ---- 查找范围 ----
// 主搜索按分组过滤；房间概念已从界面下线，这里只保留 全部 / 未分组 / 各分组。
const scope = searchScope
const scopeOptions = computed(() => [
  { value: 'all', label: '全部' },
  { value: 'ungrouped', label: '未分组' },
  ...store.groups.map((g) => ({ value: String(g.id), label: g.name })),
])
const currentScopeName = computed(
  () => scopeOptions.value.find((o) => o.value === scope.value)?.label ?? '全部',
)
function changeScope(event: Event) {
  setSearchScope((event.target as HTMLSelectElement).value)
  toast('查找范围已更新：' + currentScopeName.value)
}

// ---- 云备份（GitHub / Gitee / 自定义地址）----
function updateCloud(field: keyof CloudConfig, value: string) {
  saveCloudConfig({ ...cloudConfig.value, [field]: value } as CloudConfig)
}
async function runBackup() {
  if (cloudBusy.value) return
  try {
    const time = await backupToCloud((text) => { cloudMessage.value = text })
    cloudMessage.value = '备份完成：' + time
    toast('云备份完成')
  } catch (error) {
    cloudMessage.value = (error as Error).message
    toast((error as Error).message)
  }
}
async function runRestore() {
  if (cloudBusy.value) return
  if (!window.confirm('从云端恢复会整体替换服务器上的数据库和附件（恢复前请先备份一次现有数据）。继续？')) return
  try {
    const message = await restoreFromCloud((text) => { cloudMessage.value = text })
    cloudMessage.value = message
    toast('恢复已就绪，重启服务后生效')
  } catch (error) {
    cloudMessage.value = (error as Error).message
    toast((error as Error).message)
  }
}

// ---- 朗读 ----
function toggleTts(event: Event) {
  setTtsEnabled((event.target as HTMLInputElement).checked)
}
function toggleTtsCustom(event: Event) {
  setTtsCustomOn((event.target as HTMLInputElement).checked)
}
function testSpeak() {
  void speak('朗读测试：这是我的家。').catch((error) => toast((error as Error).message))
}
</script>

<template>
  <div class="view settings-view active">
    <div class="page-heading">
      <div>
        <p class="eyebrow">按家里的习惯来</p>
        <h1>设置</h1>
        <p class="page-description">查找范围与功能开关，也照顾好你的数据。</p>
      </div>
    </div>
    <div class="settings-card">
      <div class="settings-title">
        <div class="settings-icon"><AppIcon name="search" /></div>
        <div>
          <h3>查找范围</h3>
          <p>主搜索只在选定范围内找物品和箱子，默认全部，不用在查找时再点按钮。</p>
        </div>
      </div>
      <label class="settings-select-row"
        >当前范围<select :value="scope" aria-label="查找范围" @change="changeScope">
          <option v-for="option in scopeOptions" :key="option.value" :value="option.value">
            {{ option.label }}
          </option>
        </select></label
      >
    </div>

    <div class="settings-card">
      <div class="settings-title">
        <div class="settings-icon"><AppIcon name="download" /></div>
        <div>
          <h3>云备份</h3>
          <p>把数据库和照片备份到 GitHub / Gitee 私有仓库，可随时恢复。令牌需有该仓库读写权限。</p>
        </div>
      </div>
      <div class="cloud-backup-form">
        <label
          >平台<select
            :value="cloudConfig.provider"
            aria-label="备份平台"
            :disabled="cloudBusy"
            @change="updateCloud('provider', ($event.target as HTMLSelectElement).value)"
          >
            <option value="github">GitHub</option>
            <option value="gitee">Gitee（码云）</option>
          </select></label
        >
        <label
          >API 地址（选填，自建 Gitea 等用）<input
            :value="cloudConfig.apiBase"
            type="text"
            :disabled="cloudBusy"
            placeholder="https://gitea.example.com/api/v1"
            @change="updateCloud('apiBase', ($event.target as HTMLInputElement).value)"
          /></label
        >
        <div class="cloud-grid">
          <label
            >仓库所有者<input
              :value="cloudConfig.owner"
              type="text"
              :disabled="cloudBusy"
              placeholder="xyblue"
              @change="updateCloud('owner', ($event.target as HTMLInputElement).value)"
          /></label>
          <label
            >仓库名<input
              :value="cloudConfig.repo"
              type="text"
              :disabled="cloudBusy"
              placeholder="my_house_backup"
              @change="updateCloud('repo', ($event.target as HTMLInputElement).value)"
          /></label>
          <label
            >分支<input
              :value="cloudConfig.branch"
              type="text"
              :disabled="cloudBusy"
              placeholder="main"
              @change="updateCloud('branch', ($event.target as HTMLInputElement).value)"
          /></label>
          <label
            >访问令牌<input
              :value="cloudConfig.token"
              type="password"
              :disabled="cloudBusy"
              autocomplete="off"
              placeholder="私有令牌，只存本机"
              @change="updateCloud('token', ($event.target as HTMLInputElement).value)"
          /></label>
        </div>
        <div class="settings-actions">
          <button class="primary-btn" :disabled="cloudBusy || !cloudConfig.token" @click="runBackup">
            {{ cloudBusy ? '处理中…' : '立即备份' }}
          </button>
          <button class="outline-btn" :disabled="cloudBusy || !cloudConfig.token" @click="runRestore">
            从云端恢复
          </button>
        </div>
        <p v-if="cloudMessage" class="cloud-message" role="status">{{ cloudMessage }}</p>
        <p v-else-if="lastBackupTime" class="cloud-message">上次备份：{{ lastBackupTime }}</p>
      </div>
    </div>

    <div class="settings-card">
      <div class="settings-title">
        <div class="settings-icon"><AppIcon name="volume" /></div>
        <div>
          <h3>朗读</h3>
          <p>朗读搜索结果。默认系统语音；克隆音色 API 预留默认关闭，接入后按接口返回的音频播放。</p>
        </div>
      </div>
      <label class="settings-switch-row">
        <span>
          <b>朗读搜索结果</b>
          <em>搜索列表出现朗读按钮，点一下播报结果。</em>
        </span>
        <span class="ai-search-toggle" :class="{ active: ttsEnabled }">
          <input type="checkbox" role="switch" :checked="ttsEnabled" @change="toggleTts" />
          <span class="toggle-track" aria-hidden="true"></span>
        </span>
      </label>
      <label class="settings-switch-row">
        <span>
          <b>克隆音色 API</b>
          <em>预留接口：POST 文本到该地址，播放返回的音频。默认关闭。</em>
        </span>
        <span class="ai-search-toggle" :class="{ active: ttsCustomOn }">
          <input type="checkbox" role="switch" :checked="ttsCustomOn" @change="toggleTtsCustom" />
          <span class="toggle-track" aria-hidden="true"></span>
        </span>
      </label>
      <div v-if="ttsCustomOn" class="cloud-grid">
        <label
          >API 地址<input
            :value="ttsCustomUrl"
            type="text"
            placeholder="https://tts.example.com/speak"
            @change="setTtsCustomUrl(($event.target as HTMLInputElement).value)"
        /></label>
        <label
          >API 密钥（选填）<input
            :value="ttsCustomKey"
            type="password"
            autocomplete="off"
            placeholder="Bearer 令牌"
            @change="setTtsCustomKey(($event.target as HTMLInputElement).value)"
        /></label>
        <div class="settings-actions">
          <button class="outline-btn" @click="testSpeak">试听</button>
        </div>
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
          <div class="settings-icon"><AppIcon name="shield" /></div>
          <div>
            <h3>退出登录</h3>
            <p>清除本机的登录状态，下次打开需要重新输入家庭账号和密码。</p>
          </div>
        </div>
        <form class="settings-form" @submit.prevent="logout">
          <div class="settings-actions"><button class="primary-btn">退出登录</button></div>
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
              后，会将相关物品的名称、数量、位置等文字交给所配置的服务。照片与附件不会发送。
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
