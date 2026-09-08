import App from './App.vue'
import { createSSRApp } from 'vue'
import gdp from '@/uni_modules/gio-uniapp-autotracker/index.js'
import { dataCollectionState } from './sdk-state'

export function createApp() {
  const app = createSSRApp(App)
  // Matches the mini-program SDK integration: register plugins, then initialize once.
  gdp('registerPlugins', [{ name: 'gioEventAutoTracking' }])
  gdp('init', 'demo-account', 'demo-source', {
    uniVue: app,
    idMapping: true,
    debug: true,
    dataCollect: dataCollectionState.enabled,
  })
  return { app }
}
