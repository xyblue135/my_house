<script setup lang="ts">
import { useRoute, useRouter } from 'vue-router'
import { computed } from 'vue'
import AppIcon from './AppIcon.vue'
import { features } from '../composables/useFeatureToggles'

const router = useRouter()
const route = useRoute()

const allNavItems = [
  { name: 'containers', label: '物品', icon: 'box' },
  { name: 'space', label: '房间', icon: 'space' },
  { name: 'cooking', label: '菜谱', icon: 'cooking' },
  { name: 'settings', label: '设置', icon: 'settings' },
] as const
const navItems = computed(() => allNavItems.filter(
  (item) => item.name !== 'space' || features.spaceView,
))
const current = computed(() => route.name as string)
</script>

<template>
  <aside class="sidebar">
    <div class="brand">
      <div class="brand-mark"><AppIcon name="box" :size="24" /></div>
      <div class="brand-name">物栈 <small>ITEMNEST</small></div>
    </div>
    <nav class="nav-list" aria-label="主导航" :style="{ '--nav-cols': navItems.length }">
      <button
        v-for="item in navItems"
        :key="item.name"
        class="nav-btn"
        :class="{ active: current === item.name }"
        :aria-current="current === item.name ? 'page' : undefined"
        @click="router.push({ name: item.name })"
      >
        <AppIcon :name="item.icon" :size="22" />
        <em>{{ item.label }}</em>
      </button>
    </nav>
    <div class="sidebar-foot"><AppIcon name="home" :size="18" /><span>一起照顾好日常</span></div>
  </aside>
</template>
