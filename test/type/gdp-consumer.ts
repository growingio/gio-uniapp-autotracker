import gdp, {
  type GdpCommand,
  type GioAttributes,
  type GioGdpInitOptions,
  type GioPlugin,
  type GioPluginRuntime,
} from '../../index.js'

const app = {
  mixin(_options: Readonly<Record<string, unknown>>): void {},
}

const attributes = {
  sku: 'sku-1',
  price: 99,
  member: true,
  receivedAt: new Date(),
  tags: ['new', null, 1, false],
} satisfies GioAttributes

const initOptions = {
  uniVue: app,
  serverUrl: 'https://collector.example.com',
  dataCollect: false,
  idMapping: true,
  sessionExpires: 5,
} satisfies GioGdpInitOptions

const customerPlugin: GioPlugin = {
  name: 'customer-plugin',
  install(growingio) {
    const runtime: GioPluginRuntime = growingio
    void runtime.whenReady()
  },
}

const command: GdpCommand = gdp

command('registerPlugins', [{ name: 'gioEventAutoTracking' }, customerPlugin])
command('init', 'account-id', 'data-source-id', initOptions)
command('track', 'purchase_completed', attributes)
command('setUserId', 'user-1', 'email')
command('setUserId', 'user-1', null)
command('clearUserId')
command('setUserAttributes', attributes)
command('setOptions', { dataCollect: true })
command('setLocation', 30.2741, 120.1551)
command('clearLocation')

// @ts-expect-error unknown commands are not customer APIs.
command('getTracker')
// @ts-expect-error nested objects cannot be serialized as attributes.
command('track', 'purchase_completed', { order: { id: 'order-1' } })
// @ts-expect-error dataCollect must be a boolean and is the only mutable option.
command('setOptions', { idMapping: true })
// @ts-expect-error location requires numeric inputs at the public API boundary.
command('setLocation', '30.2741', 120.1551)
// @ts-expect-error init always requires the SDK-owned Vue App reference.
command('init', 'account-id', 'data-source-id', { dataCollect: true })
