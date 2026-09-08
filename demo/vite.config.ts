import { defineConfig } from 'vite'
import uni from '@dcloudio/vite-plugin-uni'

// Keep this before uni(): it transforms .vue templates before uni-app compiles them.
const uniPlugin = (uni as unknown as { default?: typeof uni }).default ?? uni

export default defineConfig(async () => {
  const { gioUniappAutoTrack } = await import('./uni_modules/gio-uniapp-autotracker/vite.js')
  return {
    // 只在此 demo 开放待验收的无埋点能力，正式应用不要复制此验证开关。
    define: { __GIO_AUTOTRACK_VERIFICATION__: true },
    plugins: [gioUniappAutoTrack(), uniPlugin()],
  }
})
