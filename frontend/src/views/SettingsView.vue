<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import AppIcon from '../components/AppIcon.vue'
import { api } from '../api'
import { useAppStore } from '../store'
import { useToast } from '../composables/useToast'
import { useAppBootstrap } from '../composables/useAppBootstrap'
import { searchScope, setSearchScope } from '../composables/useSearchScope'
import {
  providers, saveProviders, verifyProvider, pushToCloud, pullFromCloud, type ProviderConfig, type CloudProviders,
} from '../local/sync'
import { snapshotExists, snapshotTime, restoreSnapshot } from '../local/storage'
import {
  ttsEnabled, ttsCustomOn, ttsCustomUrl, ttsCustomKey,
  setTtsEnabled, setTtsCustomOn, setTtsCustomUrl, setTtsCustomKey, speak,
} from '../composables/useSpeech'
import type { AiSettings } from '../types'

const store = useAppStore()
const { toast } = useToast()
const { refreshData } = useAppBootstrap()

const apiKeyInput = ref('')
const showApiKey = ref(false)
const settingsSaved = ref(false)

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

onMounted(async () => {
  try {
    const saved = await api<AiSettings & { api_key?: string }>('/api/settings')
    Object.assign(store.aiSettings, saved)
    // 本机已存密钥：以密码点回显（可重新输入覆盖）
    if (saved.api_key) apiKeyInput.value = saved.api_key
  } catch (error) {
    toast((error as Error).message)
  }
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

// ---- 云同步（GitHub / Gitee 双仓库）----
type SlotKey = 'github' | 'gitee'
const syncSlots = reactive<Record<SlotKey, { busy: boolean; message: string }>>({
  github: { busy: false, message: '' },
  gitee: { busy: false, message: '' },
})
function updateProvider(slot: SlotKey, field: keyof ProviderConfig, value: string) {
  const next: CloudProviders = {
    github: { ...providers.github },
    gitee: { ...providers.gitee },
  }
  next[slot][field] = value
  saveProviders(next)
}
async function verifySlot(slot: SlotKey) {
  updateProvider(slot, 'url', providers[slot].url)
  syncSlots[slot].busy = true
  syncSlots[slot].message = ''
  try {
    syncSlots[slot].message = '✓ ' + (await verifyProvider(slot, providers[slot]))
  } catch (error) {
    syncSlots[slot].message = '✗ ' + (error as Error).message
  } finally { syncSlots[slot].busy = false }
}
async function pushSlot(slot: SlotKey) {
  updateProvider(slot, 'url', providers[slot].url)
  syncSlots[slot].busy = true
  syncSlots[slot].message = ''
  try {
    syncSlots[slot].message = await pushToCloud(slot, (text) => { syncSlots[slot].message = text }, {
      confirmNewRepo: (message) => window.confirm(message),
    })
    toast(syncSlots[slot].message)
  } catch (error) {
    syncSlots[slot].message = '✗ ' + (error as Error).message
    toast((error as Error).message)
  } finally { syncSlots[slot].busy = false }
}
async function pullSlot(slot: SlotKey) {
  updateProvider(slot, 'url', providers[slot].url)
  if (!window.confirm('拉取会用云端数据整体替换本机数据（先推送一次再拉取可防丢失，拉取前自动保留本机快照）。继续？')) return
  syncSlots[slot].busy = true
  syncSlots[slot].message = ''
  try {
    syncSlots[slot].message = await pullFromCloud(slot, (text) => { syncSlots[slot].message = text }, {
      confirmCrossRepo: (message) => window.confirm(message),
    })
    toast(syncSlots[slot].message)
    await refreshData()
  } catch (error) {
    syncSlots[slot].message = '✗ ' + (error as Error).message
    toast((error as Error).message)
  } finally { syncSlots[slot].busy = false }
}
function restoreSnapshotClick() {
  if (!window.confirm('恢复快照会把本机数据替换为「最近一次拉取前」的状态（当前数据与快照互换）。继续？')) return
  void restoreSnapshot().then(() => location.reload()).catch((error) => toast((error as Error).message))
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
const aiTesting = ref(false)
const aiTestResult = ref('')
async function testAi() {
  await saveSettings()
  aiTesting.value = true
  aiTestResult.value = ''
  try {
    const { aiTest } = await import('../local/ai')
    aiTestResult.value = await aiTest()
  } finally { aiTesting.value = false }
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

    <details class="settings-collapse">
      <summary>云同步（GitHub / Gitee）<AppIcon name="down" :size="18" /></summary>
      <div class="settings-card">
      <div class="settings-title">
        <div class="settings-icon"><AppIcon name="download" /></div>
        <div>
          <h3>云同步</h3>
          <p>数据保存在手机，通过私有仓库同步备份。GitHub 与 Gitee 各自独立，配几个用几个。</p>
        </div>
      </div>
      <div v-for="slot in (['github', 'gitee'] as SlotKey[])" :key="slot" class="cloud-backup-form">
        <h4 class="cloud-slot-title">{{ slot === 'github' ? 'GitHub 仓库' : 'Gitee 仓库' }}</h4>
        <label
          >仓库地址<input
            :value="providers[slot].url"
            type="text"
            inputmode="url"
            :disabled="syncSlots[slot].busy"
            :placeholder="slot === 'github' ? 'https://github.com/xyblue135/my_house_data' : 'https://gitee.com/xyblue135/my_house_data'"
            @change="updateProvider(slot, 'url', ($event.target as HTMLInputElement).value)"
          /></label
        >
        <div class="cloud-grid">
          <label
            >分支<input
              :value="providers[slot].branch"
              type="text"
              :disabled="syncSlots[slot].busy"
              placeholder="main"
              @change="updateProvider(slot, 'branch', ($event.target as HTMLInputElement).value)"
          /></label>
          <label
            >访问令牌<input
              :value="providers[slot].token"
              type="password"
              :disabled="syncSlots[slot].busy"
              autocomplete="off"
              placeholder="只存本机"
              @change="updateProvider(slot, 'token', ($event.target as HTMLInputElement).value)"
          /></label>
        </div>
        <div class="settings-actions">
          <button class="outline-btn" :disabled="syncSlots[slot].busy" @click="verifySlot(slot)">验证鉴权</button>
          <button class="primary-btn" :disabled="syncSlots[slot].busy" @click="pushSlot(slot)">
            {{ syncSlots[slot].busy ? '同步中…' : '推送到云端' }}
          </button>
          <button class="outline-btn" :disabled="syncSlots[slot].busy" @click="pullSlot(slot)">从云端拉取</button>
        </div>
        <p v-if="syncSlots[slot].message" class="cloud-message" role="status">{{ syncSlots[slot].message }}</p>
      </div>
      <div class="cloud-message snapshot-row">
        <span>安全快照：拉取前自动保留本机数据{{ snapshotTime() ? `（${snapshotTime()}）` : '' }}</span>
        <button class="outline-btn compact" :disabled="!snapshotExists()" @click="restoreSnapshotClick">
          恢复快照
        </button>
      </div>
      </div>
    </details>

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

    <details class="settings-collapse">
      <summary>AI 接口与数据边界<AppIcon name="down" :size="18" /></summary>
      <div class="settings-card">
      <div class="settings-title">
        <div class="settings-icon"><AppIcon name="sparkles" /></div>
        <div>
          <h3>AI 接口</h3>
          <p>兼容 OpenAI Chat Completions。密钥由自己手动输入，只存本机不上云。</p>
        </div>
      </div>
      <form class="settings-form" @submit.prevent="saveSettings">
        <label>接口地址<input v-model="store.aiSettings.base_url" placeholder="http://192.168.3.100:31415/v1" /></label>
        <label
          >接口密钥
          <div class="password-wrap">
            <input
              v-model="apiKeyInput"
              :type="showApiKey ? 'text' : 'password'"
              placeholder="由自己手动输入，不设默认"
            />
            <button type="button" @click="showApiKey = !showApiKey">
              {{ showApiKey ? '隐藏' : '显示' }}
            </button>
          </div>
        </label>
        <label>模型<input v-model="store.aiSettings.model" placeholder="auto" /></label>
        <div class="settings-actions">
          <button class="primary-btn">保存设置</button>
          <span v-if="settingsSaved">已保存</span>
          <button class="outline-btn" :disabled="aiTesting" @click="testAi">
            {{ aiTesting ? '测试中…' : '测试 AI 连接' }}
          </button>
          <span v-if="aiTestResult">{{ aiTestResult }}</span>
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
    </details>
  </div>
</template>
