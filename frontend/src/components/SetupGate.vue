<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import AppIcon from './AppIcon.vue'
import { initLocal, state, persistNow } from '../local/state'
import { aiTest } from '../local/ai'
import { providers, saveProviders, verifyProvider, pullFromCloud, type ProviderConfig, type CloudProviders } from '../local/sync'

const emit = defineEmits<{ done: [] }>()

// AI 网关：默认占位为示例地址；手机上 127.0.0.1 指手机自身，
// 网关跑在电脑上时请填电脑的局域网 IP（如 http://192.168.3.100:31415/v1）
const ai = reactive({
  base_url: localStorage.getItem('myhouse.ai.baseUrl') || 'http://192.168.3.100:31415/v1',
  model: localStorage.getItem('myhouse.ai.model') || 'auto',
  api_key: '',
})

type SlotKey = 'github' | 'gitee'
const slots = reactive<Record<SlotKey, { cfg: ProviderConfig; verifying: boolean; result: string; ok: boolean }>>({
  github: { cfg: { ...providers.github }, verifying: false, result: '', ok: false },
  gitee: { cfg: { ...providers.gitee }, verifying: false, result: '', ok: false },
})
const importing = ref(false)
const importResult = ref('')
const starting = ref(false)
const aiTesting = ref(false)
const aiTestResult = ref('')
async function testAi() {
  persistAll()
  aiTesting.value = true
  aiTestResult.value = ''
  try {
    aiTestResult.value = await aiTest()
  } finally { aiTesting.value = false }
}

const anyVerified = computed(() => slots.github.ok || slots.gitee.ok)
const bothOk = computed(() => slots.github.ok && slots.gitee.ok)

function persistAll() {
  const value: CloudProviders = { github: { ...slots.github.cfg }, gitee: { ...slots.gitee.cfg } }
  saveProviders(value)
  // AI 配置直接写入本地状态（密钥只存手机，不上云）
  state.ai.base_url = ai.base_url.trim()
  state.ai.model = ai.model.trim() || 'auto'
  if (ai.api_key.trim()) state.ai.api_key = ai.api_key.trim()
  void persistNow()
}

async function verify(slot: SlotKey) {
  persistAll()
  const target = slots[slot]
  target.verifying = true
  target.result = ''
  try {
    target.result = await verifyProvider(slot, target.cfg)
    target.ok = true
  } catch (error) {
    target.result = (error as Error).message
    target.ok = false
  } finally { target.verifying = false }
}

async function importFromCloud(slot: SlotKey) {
  persistAll()
  importing.value = true
  importResult.value = ''
  try {
    importResult.value = await pullFromCloud(slot, (text) => { importResult.value = text })
    await initLocal()
    finish()
  } catch (error) {
    importResult.value = (error as Error).message
  } finally { importing.value = false }
}

async function finish() {
  starting.value = true
  persistAll()
  await initLocal()
  emit('done')
}

async function startOffline() {
  persistAll()
  await initLocal()
  emit('done')
}
</script>

<template>
  <div class="setup-gate" role="dialog" aria-modal="true" aria-labelledby="setup-title">
    <section class="setup-card">
      <div class="brand-mark"><AppIcon name="box" :size="27" /></div>
      <p class="setup-brand">我的家 · My House</p>
      <h1 id="setup-title">初始化</h1>
      <p class="muted">数据保存在这台手机里，通过 GitHub / Gitee 私有仓库同步备份。两个仓库都配可以互为备份，也可以只配一个后离线使用。</p>

      <section class="setup-provider">
        <h2><AppIcon name="server" :size="17" /> GitHub 仓库</h2>
        <label
          >仓库地址<input
            v-model="slots.github.cfg.url"
            type="text"
            inputmode="url"
            placeholder="https://github.com/xyblue135/my_house_data"
            autocapitalize="off"
            spellcheck="false"
          />
        </label>
        <div class="setup-row">
          <label
            >分支<input v-model="slots.github.cfg.branch" type="text" placeholder="main" autocapitalize="off"
          /></label>
          <label
            >访问令牌<input
              v-model="slots.github.cfg.token"
              type="password"
              autocomplete="off"
              placeholder="Fine-grained PAT，只存本机"
          /></label>
        </div>
        <div class="setup-actions">
          <button class="outline-btn" type="button" :disabled="slots.github.verifying" @click="verify('github')">
            {{ slots.github.verifying ? '验证中…' : '验证鉴权' }}
          </button>
          <button
            class="outline-btn"
            type="button"
            :disabled="!slots.github.ok || importing"
            @click="importFromCloud('github')"
          >
            从 GitHub 导入数据
          </button>
        </div>
        <p v-if="slots.github.result" class="setup-result" :class="{ ok: slots.github.ok }" role="status">
          {{ slots.github.ok ? '✓ ' : '✗ ' }}{{ slots.github.result }}
        </p>
      </section>

      <section class="setup-provider">
        <h2><AppIcon name="server" :size="17" /> Gitee 仓库（可选）</h2>
        <label
          >仓库地址<input
            v-model="slots.gitee.cfg.url"
            type="text"
            inputmode="url"
            placeholder="https://gitee.com/xyblue135/my_house_data"
            autocapitalize="off"
            spellcheck="false"
          />
        </label>
        <div class="setup-row">
          <label
            >分支<input v-model="slots.gitee.cfg.branch" type="text" placeholder="main" autocapitalize="off"
          /></label>
          <label
            >访问令牌<input
              v-model="slots.gitee.cfg.token"
              type="password"
              autocomplete="off"
              placeholder="私人令牌，只存本机"
          /></label>
        </div>
        <div class="setup-actions">
          <button class="outline-btn" type="button" :disabled="slots.gitee.verifying" @click="verify('gitee')">
            {{ slots.gitee.verifying ? '验证中…' : '验证鉴权' }}
          </button>
          <button
            class="outline-btn"
            type="button"
            :disabled="!slots.gitee.ok || importing"
            @click="importFromCloud('gitee')"
          >
            从 Gitee 导入数据
          </button>
        </div>
        <p v-if="slots.gitee.result" class="setup-result" :class="{ ok: slots.gitee.ok }" role="status">
          {{ slots.gitee.ok ? '✓ ' : '✗ ' }}{{ slots.gitee.result }}
        </p>
      </section>

      <section class="setup-provider">
        <h2><AppIcon name="sparkles" :size="17" /> AI 接口</h2>
        <label
          >基础 URL<input
            v-model="ai.base_url"
            type="text"
            inputmode="url"
            placeholder="http://192.168.3.100:31415/v1"
            autocapitalize="off"
            spellcheck="false"
          />
        </label>
        <div class="setup-row">
          <label
            >模型<input v-model="ai.model" type="text" placeholder="auto" autocapitalize="off"
          /></label>
          <label
            >API 密钥<input
              v-model="ai.api_key"
              type="password"
              autocomplete="off"
              placeholder="由自己手动输入，不设默认"
          /></label>
        </div>
        <div class="setup-actions">
          <button class="outline-btn" type="button" :disabled="aiTesting" @click="testAi">
            {{ aiTesting ? '测试中…' : '测试 AI 连接' }}
          </button>
        </div>
        <p v-if="aiTestResult" class="setup-result" :class="{ ok: aiTestResult.startsWith('✓') }" role="status">
          {{ aiTestResult }}
        </p>
        <p class="muted">对话走 /chat/completions。默认地址按你电脑上的网关预填（手机与电脑同网段）。</p>
      </section>

      <p v-if="importResult" class="setup-result" role="status">{{ importResult }}</p>

      <div class="setup-start">
        <button class="primary-btn" :disabled="starting || importing" @click="finish">
          {{ starting ? '正在初始化…' : bothOk ? '完成初始化，开始使用' : '完成初始化，开始使用' }}
        </button>
        <button class="text-btn" :disabled="starting || importing" @click="startOffline">
          先离线使用（稍后再配仓库）
        </button>
      </div>
      <p class="muted setup-foot">初始化后可随时在「设置」里修改仓库、令牌与 AI 接口，并手动推送 / 拉取同步。</p>
    </section>
  </div>
</template>

<style scoped>
.setup-gate {
  position: fixed;
  inset: 0;
  z-index: 10000;
  overflow: auto;
  display: grid;
  place-items: start center;
  padding: max(20px, env(safe-area-inset-top)) 16px max(20px, env(safe-area-inset-bottom));
  background: #f5f7fb;
}
.setup-card {
  width: 100%;
  max-width: 520px;
  background: white;
  border: 1px solid #e4e7ec;
  border-radius: 20px;
  padding: 26px;
  box-shadow: 0 12px 40px #1018280a;
}
.setup-brand {
  font-size: 13px;
  color: #7c8b7b;
  margin: 16px 0 4px;
}
h1 {
  font-size: 24px;
  margin: 0 0 10px;
}
h2 {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 15px;
  color: #305a40;
  margin: 0 0 12px;
}
.setup-provider {
  margin-top: 20px;
  padding-top: 16px;
  border-top: 1px solid #eef1ee;
}
.setup-row {
  display: grid;
  grid-template-columns: 1fr 1.4fr;
  gap: 10px;
}
label {
  display: grid;
  gap: 6px;
  color: #344054;
  font-weight: 600;
  font-size: 13px;
  margin-top: 10px;
}
input {
  width: 100%;
  box-sizing: border-box;
  padding: 11px 12px;
  border: 1px solid #d0d5dd;
  border-radius: 10px;
  font: inherit;
  font-size: 15px;
}
input:focus {
  outline: 2px solid #9e95ff;
  outline-offset: 1px;
}
.setup-actions {
  display: flex;
  gap: 10px;
  margin-top: 12px;
  flex-wrap: wrap;
}
.setup-result {
  margin: 10px 0 0;
  font-size: 13px;
  color: #b42318;
  overflow-wrap: anywhere;
}
.setup-result.ok {
  color: #2e7d32;
}
.setup-start {
  display: grid;
  gap: 8px;
  margin-top: 24px;
}
.setup-start .primary-btn {
  min-height: 48px;
}
.setup-start .text-btn {
  justify-self: center;
  color: #7c8b7b;
}
.muted {
  font-size: 13px;
  color: #667085;
  line-height: 1.6;
  margin: 6px 0 0;
}
.setup-foot {
  margin-top: 14px;
}
.brand-mark {
  width: 46px;
  height: 46px;
  border-radius: 13px;
  background: #305a40;
  color: #fff;
  display: grid;
  place-items: center;
}
button:disabled {
  opacity: 0.6;
  cursor: wait;
}
</style>
