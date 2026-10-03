<script setup lang="ts">
import AppShell from './components/AppShell.vue'
import GlobalModals from './components/GlobalModals.vue'
import ImagePreviewModal from './components/ImagePreviewModal.vue'
import ConnectionGate from './components/ConnectionGate.vue'
import AppIcon from './components/AppIcon.vue'
import { connection } from './api'
import { useAppBootstrap } from './composables/useAppBootstrap'
import { provideItemModals, useItemModals } from './composables/useItemModals'
import { useToast } from './composables/useToast'

const { installPrompt, installApp, ready, connecting, connect } = useAppBootstrap()
const modals = useItemModals()
const { toastText } = useToast()
provideItemModals(modals)
</script>

<template>
  <ConnectionGate
    v-if="!ready || connection.status !== 'online'"
    :busy="connecting"
    @reconnect="connect"
  />
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
