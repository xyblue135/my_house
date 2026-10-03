import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router'

const routes: RouteRecordRaw[] = [
  { path: '/', redirect: '/containers' },
  { path: '/containers', name: 'containers', component: () => import('./views/ContainersView.vue'), meta: { title: '物品' } },
  { path: '/billing', name: 'billing', component: () => import('./views/BillingView.vue'), meta: { title: '账单' } },
  { path: '/cooking', name: 'cooking', component: () => import('./views/CookingView.vue'), meta: { title: '菜谱' } },
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
