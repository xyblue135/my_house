import { createApp } from 'vue'
import 'vue-virtual-scroller/dist/vue-virtual-scroller.css'
import App from './App.vue'
import { router } from './router'
import { createAppStore, provideAppStore } from './store'
import { setLanToken } from './api'
import './styles.css'
import { dialog } from './directives/dialog'

// 支持通过 URL ?token=xxx 自动配置局域网 token（手机首次访问免手动填），配完即从地址栏抹掉避免泄漏
const urlParams = new URLSearchParams(window.location.search)
const urlToken = urlParams.get('token') || urlParams.get('lanToken')
if (urlToken) {
  setLanToken(urlToken)
  urlParams.delete('token')
  urlParams.delete('lanToken')
  const qs = urlParams.toString()
  history.replaceState(null, '', `${location.pathname}${qs ? '?' + qs : ''}${location.hash}`)
}

const app = createApp(App)
app.directive('dialog', dialog)
app.use(router)
provideAppStore(app, createAppStore())
app.mount('#app')
