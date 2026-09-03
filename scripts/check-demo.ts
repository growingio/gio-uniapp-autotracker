import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { transformAutoTrackSfc } from '../autotrack/vite.js'

const root = resolve(import.meta.dirname, '..')
const required = [
  'demo/App.vue',
  'autotrack.ts',
  'demo/vite.config.ts',
  'demo/pages/index/index.vue',
  'demo/pages/custom-event/custom-event.vue',
  'demo/pages/user/user.vue',
  'demo/pages/lifecycle/lifecycle.vue',
  'demo/pages/autotrack/autotrack.vue',
  'demo/pages/route/route.vue',
  'demo/pages/datacollect/datacollect.vue',
  'demo/pages/boundary/boundary.vue',
  'demo/pages/capabilities/capabilities.vue',
]

for (const file of required) {
  if (!existsSync(resolve(root, file))) throw new Error(`missing demo file: ${file}`)
}

const main = readFileSync(resolve(root, 'demo/main.ts'), 'utf8')
if (!main.includes("@/uni_modules/gio-uniapp-autotracker/index.js") || !main.includes("gdp('registerPlugins'") || !main.includes("gdp('init', 'demo-account', 'demo-source'") || !main.includes('uniVue: app') || !main.includes('dataCollect: false')) {
  throw new Error('demo main.ts must use the gdp command entry, register autotracking, and start with collection disabled')
}
if (main.includes('deviceIdFactory') || main.includes('sessionIdFactory') || main.includes('createGioTracker')) {
  throw new Error('demo main.ts must not provide SDK-owned device, session, or host runtime internals')
}

const app = readFileSync(resolve(root, 'demo/App.vue'), 'utf8')
if (app.includes('createAppLifecycleBridge') || app.includes('createPageLifecycleBridge')) {
  throw new Error('demo App.vue must not contain SDK lifecycle bridge code')
}
for (const file of required.filter((file) => file.endsWith('.vue'))) {
  const source = readFileSync(resolve(root, file), 'utf8')
  if (source.includes('page-lifecycle') || source.includes("from '../../analytics'") || source.includes('$gio')) {
    throw new Error(`demo page must not import lifecycle or expose a tracker instance: ${file}`)
  }
}

for (const file of ['demo/main.ts', 'demo/vite.config.ts']) {
  const source = readFileSync(resolve(root, file), 'utf8')
  if (source.includes('../index.js') || source.includes('../vite.js')) {
    throw new Error(`demo must not import SDK source across the repository boundary: ${file}`)
  }
}

const vite = readFileSync(resolve(root, 'demo/vite.config.ts'), 'utf8')
const autoTrack = vite.indexOf('gioUniappAutoTrack')
const uni = vite.lastIndexOf('uni()')
if (autoTrack < 0 || uni < 0 || autoTrack > uni || !vite.includes("runtimeImport: '@/uni_modules/gio-uniapp-autotracker/autotrack.js'")) {
  throw new Error('demo Vite auto-track plugin must be configured before uni() with the compiled dispatcher import')
}
if (!vite.includes("@/uni_modules/gio-uniapp-autotracker/vite.js")) {
  throw new Error('demo Vite config must import the compiled SDK package')
}

const compiledPackage = resolve(root, 'demo/uni_modules/gio-uniapp-autotracker')
for (const file of ['index.js', 'index.d.ts', 'vite.js', 'autotrack.js', 'package.json']) {
  if (!existsSync(resolve(compiledPackage, file))) throw new Error(`missing compiled SDK artifact: ${file}`)
}
if (/from\s+['"][^'"]+\.ts['"]/.test(readFileSync(resolve(compiledPackage, 'index.js'), 'utf8'))) {
  throw new Error('demo must consume compiled JavaScript, not TypeScript source')
}
const compiledTypes = readFileSync(resolve(compiledPackage, 'index.d.ts'), 'utf8')
if (!compiledTypes.includes('declare global') || !compiledTypes.includes('const gdp: GdpCommand')) {
  throw new Error('SDK root type entry must declare the global gdp command for application pages')
}
for (const declaration of ['interface GdpCommand', 'type GioGdpInitOptions', 'type GioUniVueApp', 'type GioAttributes', 'type GioPlugin']) {
  if (!compiledTypes.includes(declaration)) throw new Error(`SDK root type entry is missing customer declaration: ${declaration}`)
}

const pages = readFileSync(resolve(root, 'demo/pages.json'), 'utf8')
for (const route of ['custom-event', 'user', 'lifecycle', 'autotrack', 'route', 'datacollect', 'boundary', 'capabilities']) {
  if (!pages.includes(`pages/${route}/${route}`)) throw new Error(`pages.json is missing ${route}`)
}

const autoTrackPage = readFileSync(resolve(root, 'demo/pages/autotrack/autotrack.vue'), 'utf8')
const transformed = transformAutoTrackSfc(autoTrackPage, '@/uni_modules/gio-uniapp-autotracker/autotrack.js')
if (!transformed.changed || !transformed.code.includes('dispatchAutoTrack as __gioAutoTrack') || !transformed.code.includes('ignored:true') || !transformed.code.includes('sensitive:true')) {
  throw new Error('auto-track showcase must compile to dispatcher calls that preserve ignore and sensitive markers')
}

console.log('demo showcase structure is valid')
