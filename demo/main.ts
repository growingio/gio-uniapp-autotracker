import App from './App.vue'
import { createSSRApp } from 'vue'
import gdp from '@/uni_modules/gio-uniapp-autotracker/index.js'

export function createApp() {
  const app = createSSRApp(App)
  // Matches the mini-program SDK integration: register plugins, then initialize once.
  gdp('registerPlugins', [{ name: 'gioEventAutoTracking' }])
  gdp('init', 'demo-account', 'demo-source', {
    uniVue: app,
    // On a physical device replace 127.0.0.1 with the development machine's LAN address.
    serverUrl: 'http://127.0.0.1:3100',
    dataCollect: false,
    idMapping: true,
    debug: true,
  })
  return { app }
}
