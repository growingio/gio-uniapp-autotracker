import sdkGdp, {
  type GdpCommand,
  type GioAttributes,
  type GioGdpInitOptions,
  type GioPlugin,
} from '../../demo/uni_modules/gio-uniapp-autotracker/index.js'

const app = {
  mixin(_options: Readonly<Record<string, unknown>>): void {},
}

const options = { uniVue: app, idMapping: true } satisfies GioGdpInitOptions
const attributes = { productId: 'sku-1', amount: 99, labels: ['sale', true] } satisfies GioAttributes
const plugin: GioPlugin = { name: 'compiled-consumer-plugin', install: (growingio) => { void growingio.whenReady() } }
const command: GdpCommand = sdkGdp

command('registerPlugins', [{ name: 'gioEventAutoTracking' }, plugin])
command('init', 'account-id', 'data-source-id', options)
command('track', 'purchase_completed', attributes)
command('setOptions', { dataCollect: true })

gdp('clearUserId')
gdp('setLocation', 30.2741, 120.1551)

// @ts-expect-error only published gdp command names are accepted.
command('getTracker')
// @ts-expect-error customer attributes are scalar values or scalar arrays.
command('setUserAttributes', { nested: { unsafe: true } })
