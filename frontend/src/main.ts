import { createApp } from 'vue'
import App from './App.vue'
import { router } from './router'
import { createAppStore, provideAppStore } from './store'
import './styles.css'
import { dialog } from './directives/dialog'

const app = createApp(App)
app.directive('dialog', dialog)
app.use(router)
provideAppStore(app, createAppStore())
app.mount('#app')
