<script setup lang="ts">
import {
  Package,
  House,
  CookingPot,
  Settings,
  Plus,
  Search,
  X,
  ChevronDown,
  ChevronRight,
  ArrowUp,
  ArrowDown,
  Trash2,
  Pencil,
  Image,
  Camera,
  Paperclip,
  Clock,
  Check,
  Folder,
  ArrowUpDown,
  Sparkles,
  Send,
  Server,
  KeyRound,
  ShieldCheck,
  RefreshCw,
  Download,
  BookOpen,
  LayoutGrid,
  CircleHelp,
  Wifi,
  Cuboid,
} from '@lucide/vue'
const icons = {
  box: Package,
  space: Cuboid,
  home: House,
  cooking: CookingPot,
  settings: Settings,
  plus: Plus,
  search: Search,
  close: X,
  down: ChevronDown,
  right: ChevronRight,
  up: ArrowUp,
  lower: ArrowDown,
  trash: Trash2,
  edit: Pencil,
  image: Image,
  camera: Camera,
  attachment: Paperclip,
  clock: Clock,
  check: Check,
  folder: Folder,
  sort: ArrowUpDown,
  sparkles: Sparkles,
  send: Send,
  server: Server,
  key: KeyRound,
  shield: ShieldCheck,
  refresh: RefreshCw,
  download: Download,
  book: BookOpen,
  grid: LayoutGrid,
  help: CircleHelp,
  wifi: Wifi,
}
withDefaults(defineProps<{ name: keyof typeof icons; size?: number }>(), { size: 20 })
</script>

<template>
  <component
    :is="icons[name]"
    :size="size"
    :stroke-width="1.8"
    aria-hidden="true"
    class="app-icon"
  />
</template>
