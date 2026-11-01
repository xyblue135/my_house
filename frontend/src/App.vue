<script setup lang="ts">
import AppShell from './components/AppShell.vue'
import GlobalModals from './components/GlobalModals.vue'
import ImagePreviewModal from './components/ImagePreviewModal.vue'
import SetupGate from './components/SetupGate.vue'
import AppIcon from './components/AppIcon.vue'
import { onBeforeUnmount, onMounted, ref, computed } from 'vue'
import { APP_VERSION, connection } from './api'


import { providers, lastSyncText } from './local/sync'
import { shouldSuggestUpdate, updateInfo } from './composables/useAppUpdate'
import { useAppBootstrap } from './composables/useAppBootstrap'
import { provideItemModals, useItemModals } from './composables/useItemModals'
import { useToast } from './composables/useToast'

const { installPrompt, installApp, ready, connect } = useAppBootstrap()
// 首启初始化只出现一次；之后数据常驻本机，打开即用
const setupDone = ref(localStorage.getItem('myhouse.setupDone') === '1')

// 品牌语：20 句收纳主题短句，首页每 5 秒轮换一次（淡入淡出）
const SLOGANS = [
  '把家里的日常，收在一起',
  '每一件物品，都有它的位置',
  '找得到，是最踏实的安心',
  '收纳有序，生活有度',
  '家越理越顺，日子越过越轻',
  '给每样东西一个家',
  '打开箱子，就找到了答案',
  '井井有条，从这一箱开始',
  '物尽其位，用时不慌',
  '记录每一次安放',
  '家的角落，藏着生活的秩序',
  '少翻一次抽屉，多一分从容',
  '收的是物品，理的是心情',
  '让每样东西都触手可及',
  '东西有家，心就不慌',
  '分门别类，一眼可见',
  '整理今天，方便明天',
  '小小收纳，大大从容',
  '家常物件，也值得被记住',
  '生活有序，日常有光',
]
const sloganIndex = ref(0)
const slogan = computed(() => SLOGANS[sloganIndex.value] ?? SLOGANS[0])
let sloganTimer: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  sloganTimer = setInterval(() => {
    sloganIndex.value = (sloganIndex.value + 1) % SLOGANS.length
  }, 5000)
})
onBeforeUnmount(() => {
  if (sloganTimer) clearInterval(sloganTimer)
})
onMounted(() => { document.addEventListener('click', () => { showSyncInfo.value = false }) })
// 右上角状态预览：本机数据 + 两个云仓库的配置与最近同步
const showSyncInfo = ref(false)
const syncInfo = computed(() => {
  const gh = providers.github.url ? '已配置' : '未配置'
  const ge = providers.gitee.url ? '已配置' : '未配置'
  return [
    { label: '数据位置', value: '本机（手机/浏览器内）' },
    { label: 'GitHub', value: gh },
    { label: 'Gitee', value: ge },
    { label: '最近同步', value: lastSyncText() },
  ]
})
function onSetupDone() {
  setupDone.value = true
  // 初始化完成必须持久化，否则每次重启都会再进初始化页
  localStorage.setItem('myhouse.setupDone', '1')
  void connect()
}
const modals = useItemModals()
const { toastText } = useToast()
provideItemModals(modals)
</script>

<template>
  <SetupGate v-if="!setupDone" @done="onSetupDone" />
  <div
    v-else-if="!ready || connection.status !== 'online'"
    class="setup-gate"
    role="status"
  >
    <section class="setup-card"><p class="muted">正在加载本地数据…</p></section>
  </div>
  <div class="app-shell" :inert="!ready || connection.status !== 'online'">
    <AppShell />

    <main class="main">
      <header class="topbar">
        <div class="mobile-brand">
          <span class="brand-mark"><img class="brand-logo" src="/icons/icon-192.png" alt="" /></span
          ><span>物栈<small class="app-version">v{{ APP_VERSION }}</small><Transition name="slogan-fade" mode="out-in"><small :key="slogan" class="slogan">{{ slogan }}</small></Transition></span>
        </div>
        <div class="desktop-breadcrumb">
          <AppIcon name="home" :size="17" /><span>我的家</span
          ><AppIcon name="right" :size="14" /><span>{{ $route.meta.title }}</span>
        </div>
        <div class="top-actions">
          <button v-if="installPrompt" class="ghost-btn install-btn" @click="installApp">
            <AppIcon name="download" :size="17" />添加到桌面
          </button>
          <button
            class="online-status"
            type="button"
            aria-label="查看数据与同步信息"
            @click.stop="showSyncInfo = !showSyncInfo"
          >
            <span></span>本机数据
          </button>
          <div v-if="showSyncInfo" class="sync-info-pop" @click.stop>
            <p class="sync-info-title">数据与同步</p>
            <p v-for="row in syncInfo" :key="row.label" class="sync-info-row">
              <span>{{ row.label }}</span><b>{{ row.value }}</b>
            </p>
            <p v-if="shouldSuggestUpdate()" class="sync-info-row">
              <span>发现新版本</span><b>{{ updateInfo?.version }}</b>
            </p>
            <p class="sync-info-tip">推送 / 拉取在「设置 → 云同步」，更新在「设置 → 检查更新」。</p>
          </div>
        </div>
      </header>

      <router-view v-if="ready" v-slot="{ Component }">
        <keep-alive :max="4">
          <component :is="Component" />
        </keep-alive>
      </router-view>
    </main>

    <GlobalModals />
    <ImagePreviewModal />

    <div class="toast" :class="{ show: toastText }" role="status" aria-live="polite">
      {{ toastText }}
    </div>
  </div>
</template>
