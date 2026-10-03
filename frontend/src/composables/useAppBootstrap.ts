import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { Capacitor } from '@capacitor/core'
import { api, AbortScope, checkConnection, connection } from '../api'
import { useAppStore } from '../store'
import type { Container, ContainerGroup, Dashboard, Item, LifecycleEntry, Member, Summary } from '../types'

const summary = ref<Summary>({ containers: 0, items: 0, quantity: 0, special: 0 })
const installPrompt = ref<any>(null)
const ready = ref(false)
const connecting = ref(false)
let initialized = false

/**
 * 应用启动钩子。在 App.vue 中调用一次即可；其他组件调用时只返回共享 state。
 * - 验证连接，加载家庭数据；设置与 MQ 按需加载
 * - 监听 Ctrl+K 跳转搜索、beforeinstallprompt 安装 PWA
 * - 恢复前台及在线时每 30 秒刷新家庭数据
 */
export function useAppBootstrap() {
  const store = useAppStore()
  const router = useRouter()
  const scope = new AbortScope()

  async function loadAll() {
    const [ms, ds, cs, gs, xs, ls] = await Promise.all([
      api<Member[]>('/api/members', { signal: scope.signal }),
      api<Dashboard>('/api/dashboard', { signal: scope.signal }),
      api<Container[]>('/api/containers', { signal: scope.signal }),
      api<ContainerGroup[]>('/api/groups', { signal: scope.signal }),
      api<Item[]>('/api/items', { signal: scope.signal }),
      api<LifecycleEntry[]>('/api/lifecycle', { signal: scope.signal }),
    ])
    store.members = ms
    store.groups = gs
    store.dashboard = ds
    Object.assign(summary.value, ds.summary)
    store.containers = cs
    store.items = xs
    store.lifecycles = ls
    if (!store.members.some(m => m.id === store.selectedOwnerId)) {
      store.setOwner(store.members[0]?.id ?? 1)
    }
  }

  async function connect() {
    if (connecting.value) return
    connecting.value = true
    try {
      await checkConnection()
      await loadAll()
      ready.value = true
    } catch (error) {
      if (connection.status === 'online') {
        connection.status = 'offline'
        connection.message = `数据加载失败：${(error as Error).message}`
      }
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
    let timer: ReturnType<typeof window.setInterval> | undefined
    const onOffline = () => {
      connection.status = 'offline'
      connection.message = '网络已断开，恢复连接后才能继续录入。'
    }
    const onResume = () => { if (document.visibilityState === 'visible') void connect() }
    onMounted(async () => {
      window.addEventListener('keydown', onKeydown)
      window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt)
      window.addEventListener('offline', onOffline)
      window.addEventListener('online', onResume)
      document.addEventListener('visibilitychange', onResume)
      if (import.meta.env.PROD && !Capacitor.isNativePlatform() && 'serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js').catch(() => undefined)
      }
      await connect()
      timer = window.setInterval(() => {
        // Failed connections only retry on user action/network recovery, not an endless loop.
        if (connection.status === 'online' && document.visibilityState === 'visible') void connect()
      }, 30000)
    })
    onBeforeUnmount(() => {
      window.removeEventListener('keydown', onKeydown)
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt)
      window.removeEventListener('offline', onOffline)
      window.removeEventListener('online', onResume)
      document.removeEventListener('visibilitychange', onResume)
      window.clearInterval(timer)
      scope.abort('unmount')
      initialized = false
    })
  }

  return { summary, installPrompt, loadAll, refreshData, installApp, ready, connecting, connect }
}
