import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import pkg from './package.json'

export default defineConfig({
  // 把 package.json 的版本号注入前端（设置页「检查更新」用）
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  plugins: [vue()],
  server: {
    host: '127.0.0.1',
    port: 15473,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:10100',
        // Preserve the browser's Host so Spring recognizes same-origin form writes.
        changeOrigin: false,
      },
    },
  },
})
