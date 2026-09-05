import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router'

const routes: RouteRecordRaw[] = [
  { path: '/', redirect: '/inventory' },
  { path: '/inventory', name: 'inventory', component: () => import('./views/InventoryView.vue'), meta: { title: '物品总览' } },
  { path: '/containers', name: 'containers', component: () => import('./views/ContainersView.vue'), meta: { title: '箱子' } },
  { path: '/lifecycle', name: 'lifecycle', component: () => import('./views/LifecycleView.vue'), meta: { title: '生命周期' } },
  { path: '/life', name: 'life', component: () => import('./views/LifeView.vue'), meta: { title: '生活中心' } },
  { path: '/assistant', name: 'assistant', component: () => import('./views/AssistantView.vue'), meta: { title: '智能助手' } },
  { path: '/settings', name: 'settings', component: () => import('./views/SettingsView.vue'), meta: { title: '设置' } },
]

export const router = createRouter({
  history: createWebHashHistory(),
  routes,
  scrollBehavior() { return { top: 0 } },
})

router.afterEach((to) => {
  if (to.meta?.title) document.title = `ItemNest · ${to.meta.title as string}`
})
