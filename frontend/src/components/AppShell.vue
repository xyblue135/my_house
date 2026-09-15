<script setup lang="ts">
import { useRoute, useRouter } from 'vue-router'
import { computed } from 'vue'

const router = useRouter()
const route = useRoute()

interface NavItem { name: string; label: string; icon: string }
const navItems: NavItem[] = [
  { name: 'containers', label: '箱子',     icon: '▦' },
  { name: 'billing',    label: '账单中心', icon: '¥' },
  { name: 'cooking',    label: '炒菜中心', icon: '食' },
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
  </aside>
</template>
