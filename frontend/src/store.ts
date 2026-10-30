import { inject, reactive, type App, type InjectionKey } from 'vue'
import type { Container, ContainerGroup, Dashboard, Item, Member, MqStatus, AiSettings } from './types'

/**
 * 全局共享 store。App 启动时在 onMounted 之前初始化，注入后所有 view 通过 useAppStore 拿到。
 * 避免 Pinia 这种重依赖；同时保持响应式。
 */
export interface AppStore {
  members: Member[]
  containers: Container[]
  groups: ContainerGroup[]
  items: Item[]
  dashboard: Dashboard | null
  mqStatus: MqStatus
  aiSettings: AiSettings
  selectedOwnerId: number
  setOwner: (id: number) => void
}

const KEY: InjectionKey<AppStore> = Symbol('myhouse.store')

export function createAppStore(): AppStore {
  return reactive<AppStore>({
    members: [],
    containers: [],
    groups: [],
    items: [],
    dashboard: null,
    mqStatus: { enabled: false, connected: false, url: '—', exchange: '—', queue: '—', last_error: '', client: '' },
    aiSettings: { base_url: '', model: 'auto', has_api_key: false },
    selectedOwnerId: 1,
    setOwner(id: number) { this.selectedOwnerId = id },
  }) as AppStore
}

export function provideAppStore(app: App, store: AppStore): void {
  app.provide(KEY, store)
}

export function useAppStore(): AppStore {
  const store = inject(KEY)
  if (!store) throw new Error('AppStore not provided. Call provideAppStore in App.vue setup.')
  return store
}
