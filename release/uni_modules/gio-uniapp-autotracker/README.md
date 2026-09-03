# gio-uniapp-autotracker

传统 uni-app 数据采集 SDK，首期面向 Vue 3 的 Android、iOS、HarmonyOS `.vue` App。

## 文档

- [全端 Measurement Protocol](./doc/measurement-protocol.md)：唯一的事件字段与端间口径来源。
- [SDK 架构设计](./doc/uniapp-sdk-development.md)：目录、模块边界、依赖方向和运行时数据链。
- [开发计划](./doc/development-plan.md)：按依赖顺序拆分的实施、验证与发布门槛。

仓库根目录就是 SDK 包根目录。`uni_modules/gio-uniapp-autotracker` 仅是使用方工程或发布压缩包中的安装位置，不在本仓库内再嵌套一层。

## Vue 3 / App 接入

在应用入口创建单个 tracker，先注册内置无埋点插件，再初始化。App 生命周期和页面生命周期只传递已裁剪的数据快照，不传递 Vue 或 `uni` 宿主对象到 core。

```ts
import { createGioTracker, createAppLifecycleBridge, createPageLifecycleBridge } from 'gio-uniapp-autotracker'

const gio = createGioTracker(uni, {
  sdkVersion: '0.1.0',
  deviceIdFactory: () => 'your-stable-device-id',
  sessionIdFactory: () => 'your-session-id',
})

gio.registerPlugins({ name: 'gioEventAutoTracking' })
gio.init({
  accountId: 'account-id',
  dataSourceId: 'data-source-id',
  serverUrl: 'https://collector.example.com',
  dataCollect: true,
})

export const appLifecycle = createAppLifecycleBridge(gio)
// 每个页面实例创建一次 bridge，并在 onLoad/onShow/onHide/onUnload 中分别转发。
export const createPageBridge = (instanceId: string) => createPageLifecycleBridge(gio, instanceId)
```

在 Vite 配置中，构建侧插件必须置于 uni 插件之前：

```ts
import { gioUniappAutoTrack } from 'gio-uniapp-autotracker/vite'

export default {
  plugins: [gioUniappAutoTrack({ enabled: true }), uni()],
}
```

无埋点仅处理当前白名单内的内置组件静态 `@click`、`@tap` 与 `@change`；input/textarea 也可采集单独声明的 `@blur` 或 `@confirm`。同一元素同时声明 `change`、`blur`、`confirm` 时只选择一个完成事件插针，原业务 handler 全部保留。`data-growing-ignore` 和敏感输入会拒绝采集；`change` 值只有在非敏感元素显式使用 `data-growing-track` 时才会被传递。动态事件、自定义组件、修饰符及歧义 listener 表达式保持业务代码不变并产生构建告警。`.nvue` 不在一期模板插桩范围内，也会产生构建告警。

当前实现已完成 TypeScript、Vue 编译与 mock collector 静态覆盖；Android、iOS、HarmonyOS 的真实编译、设备请求和服务端接收仍是发布前必需证据，尚不能据此宣称已完成三端验收。

`appCapabilityProfile(platform)` 可读取发布门禁使用的能力表。当前三端全部为 `false`，直到各端的编译版本、真机请求和 collector 接收记录归档后才可逐项开放。

`debug: true` 只在本地输出 `[GrowingIO Debug]:` 的操作标签与即将派发的协议事件数组；不会输出队列内部元数据，也不会改变隐私、重试或采集行为。

## 发布目录

执行 `pnpm run release:prepare && pnpm run release:check` 会生成并检查 `release/uni_modules/gio-uniapp-autotracker`。该目录只包含 SDK 源码、类型入口、Vite 入口和文档，不含 demo、测试、脚本或锁文件；仍须在干净 demo 和三端真机上完成发布验收。
