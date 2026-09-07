import { defineConfig } from 'vite'
import uni from '@dcloudio/vite-plugin-uni'
import { gioUniappAutoTrack } from './uni_modules/gio-uniapp-autotracker/vite.js'

// Keep this before uni(): it transforms .vue templates before uni-app compiles them.
const uniPlugin = (uni as unknown as { default?: typeof uni }).default ?? uni

export default defineConfig({
  // 只在此 demo 开放待验收的无埋点能力，正式应用不要复制此验证开关。
  define: { __GIO_AUTOTRACK_VERIFICATION__: true },
  plugins: [gioUniappAutoTrack({ runtimeImport: '@/uni_modules/gio-uniapp-autotracker/autotrack.js' }), uniPlugin()],
})
