<script setup lang="ts">
import AppShell from './components/AppShell.vue'
import GlobalModals from './components/GlobalModals.vue'
import ImagePreviewModal from './components/ImagePreviewModal.vue'
import ConnectionGate from './components/ConnectionGate.vue'
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
  <ConnectionGate v-if="!ready || connection.status !== 'online'" :busy="connecting" @reconnect="connect" />
  <div class="app-shell" :inert="!ready || connection.status !== 'online'">
    <AppShell />

    <main class="main">
      <header class="topbar">
        <div>
          <p class="eyebrow">HOUSEHOLD INVENTORY</p>
          <h1>物栈</h1>
        </div>
        <div class="top-actions">
          <button v-if="installPrompt" class="ghost-btn" @click="installApp">安装 App</button>
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

    <div class="toast" :class="{ show: toastText }">{{ toastText }}</div>
  </div>
</template>
