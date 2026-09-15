import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { api, AbortScope } from '../api'
import { useAppStore } from '../store'
import type { AiSettings, Container, Dashboard, Item, LifecycleEntry, Member, MqStatus, Summary } from '../types'
import { useToast } from './useToast'

const summary = ref<Summary>({ containers: 0, items: 0, quantity: 0, special: 0 })
const installPrompt = ref<any>(null)
let initialized = false

/**
 * 应用启动钩子。在 App.vue 中调用一次即可；其他组件调用时只返回共享 state。
 * - 加载 dashboard / containers / items / lifecycles / settings / mq
 * - 监听 Ctrl+K 跳转搜索、beforeinstallprompt 安装 PWA
 * - 切换路由时 AbortScope 会取消上次未结束的请求
 */
export function useAppBootstrap() {
  const store = useAppStore()
  const router = useRouter()
  const { toast } = useToast()
  const scope = new AbortScope()

  async function loadAll() {
    const [ms, ds, cs, xs, ls, settings, mq] = await Promise.all([
      api<Member[]>('/api/members', { signal: scope.signal }),
      api<Dashboard>('/api/dashboard', { signal: scope.signal }),
      api<Container[]>('/api/containers', { signal: scope.signal }),
      api<Item[]>('/api/items', { signal: scope.signal }),
      api<LifecycleEntry[]>('/api/lifecycle', { signal: scope.signal }),
      api<AiSettings>('/api/settings', { signal: scope.signal }),
      api<MqStatus>('/api/mq/status', { signal: scope.signal }),
    ])
    store.members = ms
    store.dashboard = ds
    Object.assign(summary.value, ds.summary)
    store.containers = cs
    store.items = xs
    store.lifecycles = ls
    Object.assign(store.aiSettings, settings)
    Object.assign(store.mqStatus, mq)
    if (!store.members.some(m => m.id === store.selectedOwnerId)) {
      store.setOwner(store.members[0]?.id ?? 1)
    }
  }

  async function refreshData() {
    const [ds, cs, xs, ls] = await Promise.all([
      api<Dashboard>('/api/dashboard', { signal: scope.signal }),
      api<Container[]>('/api/containers', { signal: scope.signal }),
      api<Item[]>('/api/items', { signal: scope.signal }),
      api<LifecycleEntry[]>('/api/lifecycle', { signal: scope.signal }),
    ])
    store.dashboard = ds
    Object.assign(summary.value, ds.summary)
    store.containers = cs
    store.items = xs
    store.lifecycles = ls
  }

  function onKeydown(event: KeyboardEvent) {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault()
      router.push({ name: 'inventory' }).then(() => {
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
    onMounted(async () => {
      window.addEventListener('keydown', onKeydown)
      window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt)
      if (import.meta.env.PROD && 'serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js').catch(() => undefined)
      }
      try { await loadAll() }
      catch (error) { toast((error as Error).message) }
    })
    onBeforeUnmount(() => {
      window.removeEventListener('keydown', onKeydown)
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt)
      scope.abort('unmount')
    })
  }

  return { summary, installPrompt, loadAll, refreshData, installApp }
}
