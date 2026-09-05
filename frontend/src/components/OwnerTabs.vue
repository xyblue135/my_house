<script setup lang="ts">
import { computed } from 'vue'
import type { Item, LifecycleEntry, Member } from '../types'
import { useAppStore } from '../store'

const props = defineProps<{
  members: Member[]
  lifecycles?: LifecycleEntry[]
  items: Item[]
  /** true: 显示 owner 切换 tabs；false: 隐藏。 */
  showOwnerTabs?: boolean
}>()

const store = useAppStore()
const filteredContainers = computed(() => store.containers.filter(c => c.owner_id === store.selectedOwnerId))
const filteredItems = computed(() => store.items.filter(i => i.owner_id === store.selectedOwnerId))
const selectedMember = computed(() => store.members.find(m => m.id === store.selectedOwnerId))
</script>

<template>
  <div v-if="showOwnerTabs" class="member-tabs">
    <span>家</span>
    <button v-for="m in members" :key="m.id" :class="{active: store.selectedOwnerId === m.id}" @click="store.setOwner(m.id)">{{ m.name }}</button>
  </div>
</template>
