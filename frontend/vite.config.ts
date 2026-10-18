import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { templateCompilerOptions } from '@tresjs/core'

export default defineConfig({
  // TresJS 的 <TresXxx> 标签需要在编译期按自定义元素处理，否则会被当成未注册组件
  plugins: [vue({ ...templateCompilerOptions })],
  server: {
    host: '127.0.0.1',
    port: 15473,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8765',
        // Preserve the browser's Host so Spring recognizes same-origin form writes.
        changeOrigin: false,
      },
    },
  },
})
