import '../../index.js'

const app = {
  mixin(_options: Readonly<Record<string, unknown>>): void {},
}

gdp('registerPlugins', [{ name: 'gioEventAutoTracking' }])
gdp('init', 'account-id', 'data-source-id', { uniVue: app, dataCollect: false })
gdp('track', 'page_opened', { source: 'global-page' })

// @ts-expect-error the SDK declaration must reject typos in global page calls too.
gdp('trakc', 'page_opened')
