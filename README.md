# gio-uniapp-autotracker

传统 uni-app 数据采集 SDK，首期面向 Vue 3 的 Android、iOS、HarmonyOS `.vue` App。

## 文档

- [全端 Measurement Protocol](./doc/measurement-protocol.md)：唯一的事件字段与端间口径来源。
- [SDK 架构设计](./doc/uniapp-sdk-development.md)：目录、模块边界、依赖方向和运行时数据链。
- [传统 uni-app 无埋点方案](./doc/uniapp-autotrack-design.md)：模板事件标识、插桩、隐私、去重和验收口径。
- [安装与发布](./doc/release.md)：npm、uni_modules 接入、版本渠道和自动发布配置。
- [开发计划](./doc/development-plan.md)：按依赖顺序拆分的实施、验证与发布门槛。

仓库根目录就是 SDK 包根目录。`uni_modules/gio-uniapp-autotracker` 仅是使用方工程或发布压缩包中的安装位置，不在本仓库内再嵌套一层。

## Vue 3 / App 接入

选择一种安装方式，同一个应用不要同时加载两份 SDK：

- npm：`npm install gio-uniapp-autotracker`，按下方包名导入。
- uni_modules：下载 GitHub Release 的 `*-uni_modules.tgz`，解压后将 `uni_modules/gio-uniapp-autotracker` 放入项目根目录。运行时导入 `@/uni_modules/gio-uniapp-autotracker/index.js`；Vite 配置导入 `./uni_modules/gio-uniapp-autotracker/vite.js`。

两种渠道均为 ESM JavaScript + `.d.ts`。Vite 入口已预设各自探针路径，正常接入均调用 `gioUniappAutoTrack()`；非标准目录可通过 `runtimeImport` 覆盖。编译插件包含自己的解析器，不要求接入方额外安装 Vue/Babel 编译依赖。

在应用入口创建 App 后，按小程序 SDK 一样调用 `gdp('registerPlugins')` 和 `gdp('init')`。`init` 传入 `uniVue: app` 后，SDK 自己读取 `uni` 宿主，并以全局 Vue mixin 自动接管 App / Page 生命周期；业务的 `App.vue` 和页面不需要引入 lifecycle bridge。

```ts
import gdp from 'gio-uniapp-autotracker'

export function createApp() {
  const app = createSSRApp(App)
  gdp('registerPlugins', [{ name: 'gioEventAutoTracking' }])
  gdp('init', 'account-id', 'data-source-id', {
    uniVue: app,
    serverUrl: 'https://collector.example.com',
    dataCollect: true,
  })
  return { app }
}
```

业务侧只通过 `gdp()` 调用 SDK，例如 `gdp('track', 'purchase', { sku: 'sku-1' })`。SDK 不向页面暴露 tracker 或 `$gio`；只有显式通过 `gdp('registerPlugins', [...])` 注册的客户插件会在 `install(growingio)` 中收到内部实例。自动页面/App 生命周期不再要求页面代码配合。

## TypeScript 类型

根入口会在客户项目中自动声明全局 `gdp`，无需额外的 `.d.ts` 文件；默认导入和全局调用具有同一组严格的命令重载。可从根入口按需导入 `GdpCommand`、`GioGdpInitOptions`、`GioUniVueApp`、`GioAttributes`、`GioPlugin` 和 `GioPluginRuntime` 等类型：

```ts
import gdp, { type GioAttributes, type GioGdpInitOptions } from 'gio-uniapp-autotracker'

const options = {
  uniVue: app,
  dataCollect: false,
  idMapping: true,
} satisfies GioGdpInitOptions

const attributes = { sku: 'sku-1', price: 99, tags: ['new', 'sale'] } satisfies GioAttributes
gdp('init', 'account-id', 'data-source-id', options)
gdp('track', 'purchase_completed', attributes)
```

支持的业务命令为 `track`、`setUserId`、`clearUserId`、`setUserAttributes`、`setOptions({ dataCollect })`、`setLocation` 和 `clearLocation`；`registerPlugins` 与 `init` 是入口命令。未知命令、错误参数个数、嵌套属性或非布尔 `dataCollect` 均会在 TypeScript 编译期报错。`GioPluginRuntime` 只会作为显式注册插件的 `install(growingio)` 参数出现，页面代码仍只能调用 `gdp()`。

无埋点的模板插桩是一个构建期能力，因此 Vue 3/Vite 项目仍需在 `vite.config.ts` 增加一次插件（且必须排在 `uni()` 前）。这项配置不能放在运行时 `main.ts`，因为模板在应用代码执行前就已编译：

```ts
import { defineConfig } from 'vite'
import uni from '@dcloudio/vite-plugin-uni'

const uniPlugin = (uni as unknown as { default?: typeof uni }).default ?? uni
export default defineConfig(async () => {
  const { gioUniappAutoTrack } = await import('gio-uniapp-autotracker/vite')
  return { plugins: [gioUniappAutoTrack(), uniPlugin()] }
})
```

异步导入支持未声明 `"type": "module"` 的现有 Vite 配置，不要求更改整个业务工程的模块类型。uni_modules 将上面的导入路径替换为 `./uni_modules/gio-uniapp-autotracker/vite.js`。已使用 ESM 配置的工程也可静态导入，详见[安装说明](./doc/release.md)。

无埋点仅处理当前白名单内的内置组件静态 `@click`、`@tap` 与 `@change`；input/textarea 也可采集单独声明的 `@blur` 或 `@confirm`。普通模板 `xpath` 在 runtime 按小程序口径生成 `id#eventName`；`uni-link` 使用 `#openURL`，tabBar 使用 `#onTabItemTap`。同一元素同时声明 `change`、`blur`、`confirm` 时只选择一个完成事件插针，原业务 handler 全部保留。`data-growing-ignore` 和敏感输入会拒绝整条采集，`data-growing-track` 不能覆盖敏感规则；非敏感 `change` 值仅在显式标记 track 时传递。`data-index` 仅接受大于 0 且小于 2147483647 的整数。动态事件、自定义组件、修饰符及歧义 listener 表达式保持业务代码不变、不插桩并产生构建告警。`.nvue` 不在一期模板插桩范围内，也会产生构建告警。完整规则见[无埋点方案](./doc/uniapp-autotrack-design.md)。

业务行为不变是插桩的前提。可安全分析的显式调用（如 `save($event)`）、带简单首参数的同步函数和两侧均为显式调用的简单条件表达式可以插桩。`@click="save"`、`actions.save`、条件返回函数、复杂组件选项等保持源码原样并告警，不会擅自改成调用。需要精确采集这些交互时可在业务原有 handler 中调用 `gdp('track', ...)`，不要为了消除告警随意改写业务模板。

动态绑定只由原模板求值，SDK 不在事件时重新求值 getter、range 或其他绑定。动态 `data-*` 依赖宿主原生 dataset；picker 的动态 range 无法安全取文案时使用下标，动态链接可由业务明确提供 `data-src`。静态字面量仍可进入探针。

编译侧 Vue 解析器固定为 `3.4.21`，随 Vite 工具打包，与 App 运行时隔离。SDK 上报版本固定取包版本，不能由 `init` 参数覆盖。

自动测试与 HBuilderX 编译检查不等于三端真机验收。Android、iOS、HarmonyOS 的设备请求和服务端接收证据仍须在正式发布前补齐，验收边界见[无埋点发布说明](./doc/autotrack-v2-release.md)。

`platform/capabilities.ts` 的能力表同时参与无埋点运行时门控。当前三端 `autoClick`、`tabBar` 和逐组件 `autoChange` 全部为 `false`，因此默认不发送模板或 tabBar 的 `VIEW_*`。待对应端的编译版本、真机请求和 collector 接收记录归档后，再逐项开放；单元测试使用内部受控宿主配置；demo 通过专用构建常量 `__GIO_AUTOTRACK_VERIFICATION__` 显式开放待验收链路，便于实机验证。验证开关不会改变生产验收状态，正式应用不要复制。

`debug: true` 只在本地输出 `[GrowingIO Debug]:` 的操作标签与即将派发的协议事件数组；不会输出队列内部元数据，也不会改变隐私、重试或采集行为。

## Showcase demo

先运行 `pnpm build:sdk`，它将编译产物写入 `demo/uni_modules/gio-uniapp-autotracker`。然后可用 HBuilderX 打开 [demo](./demo) 目录；demo 只引用这份编译产物，不跨目录引用 SDK 源码。它默认采集，以便启动后验证 `VISIT`、生命周期、`track`、身份和用户属性、路由上下文、无埋点业务交互及 `dataCollect` 动态开关；如需隐私同意流程，可在 `demo/sdk-state.ts` 将 `enabled` 设为 `false` 后通过示例页恢复采集。ABTest 和微信分享会明确显示为当前未实现，而非模拟接口结果。详见 [demo/README.md](./demo/README.md)。

schema v2 与旧编译探针互不兼容，升级时必须整体重新构建 App。同名 handler 无 id 时使用相同标识；需区分的元素应补稳定 `id`，列表附加维度使用规范正整数 `data-index`。迁移说明见[无埋点发布说明](./doc/autotrack-v2-release.md)。

## 发布目录

执行 `pnpm run release:prepare && pnpm run release:check`，同一次构建生成 `dist/npm` 和 `dist/uni_modules/gio-uniapp-autotracker`，最终压缩包及摘要在 `dist/release`。`demo/uni_modules` 同步使用生成产物；这些目录均不提交 Git。

推送与 `package.json.version` 一致的 `v版本号` 标签会触发 GitHub Actions：检查、构建、独立安装验证、npm 发布和 GitHub Release 附件上传。正式版走 `latest`，预发布走 `next` 并标记 GitHub prerelease。DCloud 插件市场暂不上架。首次发布前需完成 npm 所有权及 Trusted Publisher 配置，操作流程见[安装与发布](./doc/release.md)。
