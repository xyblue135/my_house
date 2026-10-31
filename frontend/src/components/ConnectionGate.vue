<script setup lang="ts">
import { computed, ref } from 'vue'
import AppIcon from './AppIcon.vue'
import { Capacitor } from '@capacitor/core'
import { api, connection, getApiBase, setApiBase, setSessionToken } from '../api'

const props = defineProps<{ busy: boolean }>()
const emit = defineEmits<{ reconnect: [] }>()
const address = ref(getApiBase())
const username = ref('')
const password = ref('')
// 原生 App 首次使用必须填服务地址，默认展开连接设置；网页同源连接可折叠。
const showSettings = ref(Capacitor.isNativePlatform())
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
    setSessionToken(result.token)
    // 令牌就绪后直接重连，避免整页刷新；连接失败时门会继续显示最新状态
    emit('reconnect')
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    loggingIn.value = false
  }
}
</script>

<template>
  <div class="connection-gate" role="dialog" aria-modal="true" aria-labelledby="connection-title">
    <section class="connection-card">
      <div class="connection-head">
        <div class="brand-mark"><AppIcon name="box" :size="27" /></div>
        <button
          class="gate-gear"
          type="button"
          :aria-expanded="showSettings"
          aria-label="连接设置"
          :title="showSettings ? '收起连接设置' : '连接设置'"
          @click="showSettings = !showSettings"
        >
          <AppIcon name="settings" :size="19" />
        </button>
      </div>
      <p class="connection-brand">我的家 · My House</p>
      <h1 id="connection-title">{{ title }}</h1>
      <p role="status">{{ connection.message || '连接成功后即可使用我的家。' }}</p>
      <p class="muted">物品和照片统一保存在服务器。连接后，就能和家人一起查找与整理。</p>
      <form @submit.prevent="login">
        <label
          >账号
          <input
            v-model="username"
            type="text"
            :disabled="loggingIn || busy"
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
            :disabled="loggingIn || busy"
            autocomplete="current-password"
            placeholder="家庭密码"
          />
        </label>
        <div v-if="showSettings" class="gate-settings">
          <label
            >服务地址
            <input
              v-model="address"
              type="text"
              inputmode="url"
              :required="native"
              :disabled="loggingIn || busy"
              placeholder="https://items.example.com"
              autocomplete="url"
              autocapitalize="off"
              spellcheck="false"
            />
          </label>
          <p v-if="!native" class="muted">使用当前网站的服务器时，地址可以留空。</p>
        </div>
        <p v-if="error" role="alert" class="connection-error">{{ error }}</p>
        <button class="primary-btn" :disabled="loggingIn || busy">
          {{ loggingIn || busy ? '登录中…' : '登录' }}
        </button>
      </form>
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
.connection-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.gate-gear {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border: 1px solid #e4e7ec;
  border-radius: 10px;
  background: #f9fafb;
  color: #475467;
  cursor: pointer;
}
.gate-gear[aria-expanded='true'] {
  background: #eef2f6;
}
.gate-settings {
  display: grid;
  gap: 8px;
  padding: 14px;
  border: 1px dashed #d0d5dd;
  border-radius: 12px;
  background: #f9fafb;
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
button:disabled {
  opacity: 0.6;
  cursor: wait;
}
</style>
