<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import AppShell from './components/AppShell.vue'
import GlobalModals from './components/GlobalModals.vue'
import OwnerTabs from './components/OwnerTabs.vue'
import { useAppStore } from './store'
import { useAppBootstrap } from './composables/useAppBootstrap'
import { provideItemModals, useItemModals } from './composables/useItemModals'
import { useToast } from './composables/useToast'

const store = useAppStore()
const { installPrompt, installApp, refreshData } = useAppBootstrap()
const modals = useItemModals()
const { toastText } = useToast()
provideItemModals(modals)

const route = computed(() => (typeof location !== 'undefined' ? location.hash : ''))
function isInventory(): boolean { return route.value.startsWith('#/inventory') || route.value === '' || route.value === '#/' }
function isContainers(): boolean { return route.value.startsWith('#/containers') }
function isLifecycle(): boolean { return route.value.startsWith('#/lifecycle') }
function isLife(): boolean { return route.value.startsWith('#/life') }
function isAssistant(): boolean { return route.value.startsWith('#/assistant') }
function isSettings(): boolean { return route.value.startsWith('#/settings') }

const showCreateMenu = ref(false)
const createMenuRef = ref<HTMLElement | null>(null)
function toggleCreateMenu() { showCreateMenu.value = !showCreateMenu.value }
function openQuickEntry() { modals.openQuickEntry(); showCreateMenu.value = false }
function openAddItem() { modals.openAddItem(); showCreateMenu.value = false }
function openAddContainer() { modals.openAddContainer(); showCreateMenu.value = false }

function onDocumentClick(event: MouseEvent) {
  if (!showCreateMenu.value) return
  const target = event.target as Node | null
  if (createMenuRef.value && target && !createMenuRef.value.contains(target)) {
    showCreateMenu.value = false
  }
}
onMounted(() => document.addEventListener('click', onDocumentClick))
onUnmounted(() => document.removeEventListener('click', onDocumentClick))
watch(() => route.value, () => { showCreateMenu.value = false })
</script>

<template>
  <div class="app-shell">
    <AppShell />

    <main class="main">
      <header class="topbar">
        <div>
          <p class="eyebrow">HOUSEHOLD INVENTORY</p>
          <h1>物栈</h1>
        </div>
        <div class="top-actions">
          <button v-if="installPrompt" class="ghost-btn" @click="installApp">安装 App</button>
          <div v-if="isInventory() || isContainers()" ref="createMenuRef" class="create-menu">
            <button class="primary-btn" @click.stop="toggleCreateMenu">
              <span>＋ 新增</span><span class="caret">▾</span>
            </button>
            <div v-if="showCreateMenu" class="create-menu-pop" @click.stop>
              <button class="create-menu-item" @click="openAddItem">添加物品</button>
              <button class="create-menu-item" @click="openAddContainer">新建箱子</button>
              <button class="create-menu-item" @click="openQuickEntry">快速录入（多个）</button>
            </div>
          </div>
        </div>
      </header>

      <OwnerTabs
        v-if="!isSettings() && !isAssistant() && !isLife()"
        :members="store.members"
        :items="store.items"
        :show-owner-tabs="true" />

      <router-view v-slot="{ Component }">
        <keep-alive :max="4">
          <component :is="Component" />
        </keep-alive>
      </router-view>
    </main>

    <GlobalModals />

    <div class="toast" :class="{ show: toastText }">{{ toastText }}</div>
  </div>
</template>
