<script setup lang="ts">
import AppShell from './components/AppShell.vue'
import GlobalModals from './components/GlobalModals.vue'
import ImagePreviewModal from './components/ImagePreviewModal.vue'
import SetupGate from './components/SetupGate.vue'
import AppIcon from './components/AppIcon.vue'
import { ref } from 'vue'
import { connection } from './api'
import { useAppBootstrap } from './composables/useAppBootstrap'
import { provideItemModals, useItemModals } from './composables/useItemModals'
import { useToast } from './composables/useToast'

const { installPrompt, installApp, ready, connect } = useAppBootstrap()
// 首启初始化只出现一次；之后数据常驻本机，打开即用
const setupDone = ref(localStorage.getItem('myhouse.setupDone') === '1')
function onSetupDone() {
  setupDone.value = true
  void connect()
}
const modals = useItemModals()
const { toastText } = useToast()
provideItemModals(modals)
</script>

<template>
  <SetupGate v-if="!setupDone" @done="onSetupDone" />
  <div
    v-else-if="!ready || connection.status !== 'online'"
    class="setup-gate"
    role="status"
  >
    <section class="setup-card"><p class="muted">正在加载本地数据…</p></section>
  </div>
  <div class="app-shell" :inert="!ready || connection.status !== 'online'">
    <AppShell />

    <main class="main">
      <header class="topbar">
        <div class="mobile-brand">
          <span class="brand-mark"><AppIcon name="box" :size="21" /></span
          ><span>物栈<small>把家里的日常，收在一起</small></span>
        </div>
        <div class="desktop-breadcrumb">
          <AppIcon name="home" :size="17" /><span>我的家</span
          ><AppIcon name="right" :size="14" /><span>{{ $route.meta.title }}</span>
        </div>
        <div class="top-actions">
          <button v-if="installPrompt" class="ghost-btn install-btn" @click="installApp">
            <AppIcon name="download" :size="17" />添加到桌面
          </button>
          <span class="online-status"><span></span>已连接</span>
        </div>
      </header>

      <router-view v-if="ready" v-slot="{ Component }">
        <keep-alive :max="4">
          <component :is="Component" />
        </keep-alive>
      </router-view>
    </main>

    <GlobalModals />
    <ImagePreviewModal />

    <div class="toast" :class="{ show: toastText }" role="status" aria-live="polite">
      {{ toastText }}
    </div>
  </div>
</template>
