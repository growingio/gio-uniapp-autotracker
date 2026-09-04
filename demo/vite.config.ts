import { defineConfig } from 'vite'
import uni from '@dcloudio/vite-plugin-uni'
import { gioUniappAutoTrack } from './uni_modules/gio-uniapp-autotracker/vite.js'

// Keep this before uni(): it transforms .vue templates before uni-app compiles them.
const uniPlugin = (uni as unknown as { default?: typeof uni }).default ?? uni

export default defineConfig({
  plugins: [gioUniappAutoTrack({ runtimeImport: '@/uni_modules/gio-uniapp-autotracker/autotrack.js' }), uniPlugin()],
})
