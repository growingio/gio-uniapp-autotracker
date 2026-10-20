import App from './App.vue'
import { createSSRApp } from 'vue'
import gdp from '@/uni_modules/gio-uniapp-autotracker/index.js'
import { dataCollectionState } from './sdk-state'

/** 创建 Vue 应用，先注册插件再初始化 SDK，并将应用交给生命周期安装器。 */
export function createApp() {
  const app = createSSRApp(App)
  // 沿用小程序 SDK 的接入顺序：先注册插件，再执行一次初始化。
  gdp('registerPlugins', [{ name: 'gioEventAutoTracking' }])
  gdp('init', 'demo-account', 'demo-source', {
    uniVue: app,
    idMapping: true,
    debug: true,
    dataCollect: dataCollectionState.enabled,
  })
  return { app }
}
