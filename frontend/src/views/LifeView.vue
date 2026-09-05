<script setup lang="ts">
import { useAppStore } from '../store'
import LifeHub from '../components/LifeHub.vue'
import { useToast } from '../composables/useToast'

const store = useAppStore()
const { toast } = useToast()
</script>

<template>
  <div class="view life-view active">
    <LifeHub :members="store.members" @toast="toast" />
  </div>
</template>
