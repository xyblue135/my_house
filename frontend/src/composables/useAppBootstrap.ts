import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { api, AbortScope, connection } from '../api'
import { initLocal } from '../local/state'
import { useAppStore } from '../store'
import type { Container, ContainerGroup, Dashboard, Item, Member } from '../types'

const summary = ref({ containers: 0, items: 0, quantity: 0, special: 0 })
const installPrompt = ref<any>(null)
const ready = ref(false)
const connecting = ref(false)
let initialized = false

/**
 * 应用启动钩子：加载本地数据（IndexedDB），填充 store。
 * 单机模式：无网络依赖，数据随改随存，云端同步在设置页手动/自动触发。
 */
export function useAppBootstrap() {
  const store = useAppStore()
  const router = useRouter()
  const scope = new AbortScope()

  async function loadAll() {
    const [ms, ds, cs, gs, xs] = await Promise.all([
      api<Member[]>('/api/members', { signal: scope.signal }),
      api<Dashboard>('/api/dashboard', { signal: scope.signal }),
      api<Container[]>('/api/containers', { signal: scope.signal }),
      api<ContainerGroup[]>('/api/groups', { signal: scope.signal }),
      api<Item[]>('/api/items', { signal: scope.signal }),
    ])
    store.members = ms
    store.groups = gs
    store.dashboard = ds
    Object.assign(summary.value, ds.summary)
    store.containers = cs
    store.items = xs
    if (!store.members.some(m => m.id === store.selectedOwnerId)) {
      store.setOwner(store.members[0]?.id ?? 1)
    }
  }

  async function connect() {
    if (connecting.value) return
    connecting.value = true
    try {
      connection.status = 'checking'
      await initLocal()
      connection.status = 'online'
      await loadAll()
      ready.value = true
    } catch (error) {
      connection.status = 'offline'
      connection.message = `本地数据加载失败：${(error as Error).message}`
    } finally { connecting.value = false }
  }

  async function refreshData() { await loadAll() }

  function onKeydown(event: KeyboardEvent) {
    if (document.querySelector('[aria-modal="true"]')) return
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault()
      router.push({ name: 'containers' }).then(() => {
        document.querySelector<HTMLInputElement>('.search-box input')?.focus()
      })
    }
  }
  function onBeforeInstallPrompt(event: Event) {
    event.preventDefault()
    installPrompt.value = event
  }
  async function installApp() {
    if (!installPrompt.value) return
    installPrompt.value.prompt()
    await installPrompt.value.userChoice
    installPrompt.value = null
  }

  if (!initialized) {
    initialized = true
    onMounted(() => {
      window.addEventListener('keydown', onKeydown)
      window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt)
      void connect()
    })
    onBeforeUnmount(() => {
      window.removeEventListener('keydown', onKeydown)
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt)
      scope.abort('unmount')
      initialized = false
    })
  }

  return { summary, installPrompt, loadAll, refreshData, installApp, ready, connecting, connect }
}
