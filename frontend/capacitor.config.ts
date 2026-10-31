import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.xyblue.myhouse',
  appName: '我的家',
  webDir: 'dist',
  // Bundle the Vue build; the API address is set on first launch. Never load a remote UI.
  // cleartext：允许 App 访问局域网 HTTP 服务（AI 网关等）；对外仍建议 HTTPS
  server: { androidScheme: 'https', cleartext: true },
}

export default config
