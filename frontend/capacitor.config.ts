import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.xyblue.myhouse',
  appName: '我的家',
  webDir: 'dist',
  // Bundle the Vue build; the API address is set on first launch. Never load a remote UI.
  server: { androidScheme: 'https', cleartext: false },
}

export default config
