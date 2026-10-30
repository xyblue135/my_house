<script setup lang="ts">
import { computed, ref } from 'vue'
import AppIcon from './AppIcon.vue'
import { Capacitor } from '@capacitor/core'
import { api, connection, getApiBase, getLanToken, setApiBase, setLanToken } from '../api'

const props = defineProps<{ busy: boolean }>()
const emit = defineEmits<{ reconnect: [] }>()
const address = ref(getApiBase())
const token = ref(getLanToken() || '')
const username = ref('')
const password = ref('')
const mode = ref<'account' | 'token'>('account')
const loggingIn = ref(false)
const error = ref('')
const native = Capacitor.isNativePlatform()
const title = computed(() =>
  props.busy || loggingIn.value
    ? '正在连接…'
    : connection.status === 'unauthorized'
      ? '需要登录验证'
      : '连接家庭服务器',
)

async function login() {
  error.value = ''
  loggingIn.value = true
  try {
    setApiBase(address.value)
    const result = await api<{ token: string; username: string }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: username.value.trim(), password: password.value }),
      allowUnconnected: true,
    })
    setLanToken(result.token)
    location.reload()
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    loggingIn.value = false
  }
}

function connect() {
  error.value = ''
  try {
    const changed =
      address.value.trim().replace(/\/$/, '') !== getApiBase() ||
      token.value.trim() !== (getLanToken() || '')
    setApiBase(address.value)
    setLanToken(token.value)
    if (changed) location.reload()
    else emit('reconnect')
  } catch (e) {
    error.value = (e as Error).message
  }
}

function submit() {
  if (mode.value === 'account') void login()
  else connect()
}
</script>

<template>
  <div class="connection-gate" role="dialog" aria-modal="true" aria-labelledby="connection-title">
    <section class="connection-card">
      <div class="brand-mark"><AppIcon name="box" :size="27" /></div>
      <p class="connection-brand">我的家 · My House</p>
      <h1 id="connection-title">{{ title }}</h1>
      <p role="status">{{ connection.message || '连接成功后即可使用我的家。' }}</p>
      <p class="muted">物品和照片统一保存在服务器。连接后，就能和家人一起查找与整理。</p>
      <form @submit.prevent="submit">
        <label
          >服务地址
          <input
            v-model="address"
            type="text"
            inputmode="url"
            :required="native"
            :disabled="busy || loggingIn"
            placeholder="https://items.example.com"
            autocomplete="url"
            autocapitalize="off"
            spellcheck="false"
          />
        </label>
        <p v-if="!native" class="muted">使用当前网站的服务器时，地址可以留空。</p>
        <template v-if="mode === 'account'">
          <label
            >账号
            <input
              v-model="username"
              type="text"
              :disabled="busy || loggingIn"
              autocomplete="username"
              autocapitalize="off"
              spellcheck="false"
              placeholder="家庭账号"
            />
          </label>
          <label
            >密码
            <input
              v-model="password"
              type="password"
              :disabled="busy || loggingIn"
              autocomplete="current-password"
              placeholder="家庭密码"
            />
          </label>
        </template>
        <template v-else>
          <label
            >家庭访问密钥
            <input
              v-model="token"
              type="password"
              :disabled="busy"
              autocomplete="current-password"
              placeholder="填写家人提供的访问密钥"
            />
          </label>
        </template>
        <p v-if="error" role="alert" class="connection-error">{{ error }}</p>
        <button class="primary-btn" :disabled="busy || loggingIn">
          {{ loggingIn ? '登录中…' : busy ? '连接中…' : mode === 'account' ? '登录' : '连接' }}
        </button>
      </form>
      <p class="muted mode-switch">
        <a href="#" @click.prevent="mode = mode === 'account' ? 'token' : 'account'">
          {{ mode === 'account' ? '使用家庭访问密钥连接' : '使用账号密码登录' }}
        </a>
      </p>
    </section>
  </div>
</template>

<style scoped>
.connection-gate {
  position: fixed;
  inset: 0;
  z-index: 10000;
  overflow: auto;
  display: grid;
  place-items: center;
  padding: max(20px, env(safe-area-inset-top)) 20px max(20px, env(safe-area-inset-bottom));
  background: #f5f7fb;
}
.connection-card {
  width: 100%;
  max-width: 440px;
  background: white;
  border: 1px solid #e4e7ec;
  border-radius: 20px;
  padding: 28px;
  box-shadow: 0 12px 40px #1018280a;
}
h1 {
  font-size: 24px;
  margin: 20px 0 12px;
}
p {
  line-height: 1.6;
  color: #475467;
}
form {
  display: grid;
  gap: 16px;
  margin-top: 24px;
}
label {
  display: grid;
  gap: 8px;
  color: #344054;
  font-weight: 600;
}
input {
  width: 100%;
  box-sizing: border-box;
  padding: 12px;
  border: 1px solid #d0d5dd;
  border-radius: 10px;
  font: inherit;
  font-size: 16px;
}
input:focus {
  outline: 2px solid #9e95ff;
  outline-offset: 1px;
}
button {
  min-height: 46px;
  justify-content: center;
}
.muted {
  font-size: 13px;
  margin: 0;
}
.connection-error {
  color: #b42318;
  margin: 0;
}
.mode-switch {
  margin-top: 16px;
  text-align: center;
}
.mode-switch a {
  color: #475467;
}
button:disabled {
  opacity: 0.6;
  cursor: wait;
}
</style>
