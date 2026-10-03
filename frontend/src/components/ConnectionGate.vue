<script setup lang="ts">
import { computed, ref } from 'vue'
import AppIcon from './AppIcon.vue'
import { Capacitor } from '@capacitor/core'
import { connection, getApiBase, getLanToken, setApiBase, setLanToken } from '../api'

const props = defineProps<{ busy: boolean }>()
const emit = defineEmits<{ reconnect: [] }>()
const address = ref(getApiBase())
const token = ref(getLanToken() || '')
const error = ref('')
const native = Capacitor.isNativePlatform()
const title = computed(() =>
  props.busy
    ? '正在连接…'
    : connection.status === 'unauthorized'
      ? '需要家庭访问密钥'
      : '连接家庭服务器',
)

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
</script>

<template>
  <div class="connection-gate" role="dialog" aria-modal="true" aria-labelledby="connection-title">
    <section class="connection-card">
      <div class="brand-mark"><AppIcon name="box" :size="27" /></div>
      <p class="connection-brand">物栈 · ItemNest</p>
      <h1 id="connection-title">{{ title }}</h1>
      <p role="status">{{ connection.message || '连接成功后即可使用物栈。' }}</p>
      <p class="muted">物品和照片统一保存在服务器。连接后，就能和家人一起查找与整理。</p>
      <form @submit.prevent="connect">
        <label
          >服务地址
          <input
            v-model="address"
            type="text"
            inputmode="url"
            :required="native"
            :disabled="busy"
            placeholder="https://items.example.com"
            autocomplete="url"
            autocapitalize="off"
            spellcheck="false"
          />
        </label>
        <p v-if="!native" class="muted">使用当前网站的服务器时，地址可以留空。</p>
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
        <p v-if="error" role="alert" class="connection-error">{{ error }}</p>
        <button class="primary-btn" :disabled="busy">{{ busy ? '连接中…' : '连接' }}</button>
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
