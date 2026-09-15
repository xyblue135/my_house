<script setup lang="ts">
import { useRoute, useRouter } from 'vue-router'
import { computed } from 'vue'
import { useAppStore } from '../store'

const router = useRouter()
const route = useRoute()
const store = useAppStore()

interface NavItem { name: string; label: string; icon: string }
const navItems: NavItem[] = [
  { name: 'inventory',  label: '物品总览', icon: '◰' },
  { name: 'containers', label: '箱子',     icon: '▦' },
  { name: 'lifecycle',  label: '生命周期', icon: '◴' },
  { name: 'life',       label: '生活中心', icon: '◍' },
  { name: 'assistant',  label: '智能助手', icon: '✦' },
  { name: 'settings',   label: '设置',     icon: '✱' },
]
const current = computed(() => route.name as string)
</script>

<template>
  <aside class="sidebar">
    <div class="brand">
      <div class="brand-mark">IN</div>
      <div class="brand-name">ItemNest</div>
    </div>
    <nav class="nav-list">
      <button
        v-for="item in navItems"
        :key="item.name"
        class="nav-btn"
        :class="{ active: current === item.name }"
        @click="router.push({ name: item.name })">
        <span>{{ item.icon }}</span>
        <em>{{ item.label }}</em>
      </button>
    </nav>
    <div class="sidebar-foot">
      <div class="owner-picker">
        <label>当前视角</label>
        <select :value="store.selectedOwnerId" @change="store.setOwner(Number(($event.target as HTMLSelectElement).value))">
          <option v-for="m in store.members" :key="m.id" :value="m.id">{{ m.name }}</option>
        </select>
      </div>
    </div>
  </aside>
</template>
