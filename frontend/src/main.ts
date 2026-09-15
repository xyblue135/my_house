import { createApp } from 'vue'
import 'vue-virtual-scroller/dist/vue-virtual-scroller.css'
import App from './App.vue'
import { router } from './router'
import { createAppStore, provideAppStore } from './store'
import './styles.css'

const app = createApp(App)
app.use(router)
provideAppStore(app, createAppStore())
app.mount('#app')
