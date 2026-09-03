# GrowingIO uni-app SDK Showcase

这是传统 uni-app Vue 3 App 的可运行 showcase。它与 uni-app x demo 对齐展示已实现的功能：生命周期、`PAGE` 上下文、自定义事件、用户身份/属性、Vite 无埋点、路由 query 和 `dataCollect` 动态开关。

默认 `dataCollect: false`，因此首次启动不会产生或发送采集事件。SDK 的完整初始化与 App/Page 生命周期接入只在 `main.ts` 里使用小程序同款的 `gdp('registerPlugins')` 与 `gdp('init', ..., { uniVue: app })`；`App.vue` 和各演示页面都不需要 bridge 或 tracker import，业务调用也全部使用 `gdp('xxx')`，不暴露 `$gio` 或内部 tracker。`gioABTest`、微信分享和 `.nvue` 自动采集并非当前传统 App SDK 的能力；首页的“当前能力边界”区会明确说明，绝不伪造成功结果。

先执行一次 `pnpm build:sdk`。它会将 SDK 编译为 `demo/uni_modules/gio-uniapp-autotracker`；demo 只从该产物导入，绝不跨目录引用仓库源码。随后在 HBuilderX 中打开此 `demo/` 目录并运行 App。`vite.config.ts` 已把 `gioUniappAutoTrack()` 放在 `uni()` 前面，因此原生 `.vue` 页面会在构建时插入无埋点 dispatcher。

边界场景归属于对应功能页：自定义事件页验证空事件名、未知命令和属性过滤；用户页验证非字符串身份、位置设置/清除与越界位置；生命周期页验证初始化后不能再注册插件；采集开关页验证 `setOptions` 只接受 `{ dataCollect: boolean }`。属性过滤是不同于失败的边界：事件成功入队，但嵌套对象和非有限数不会进入 collector。`pnpm test` 中的 demo 场景会覆盖：`main.ts` 的唯一接入点与菜单页面映射、实际无埋点页面的编译输出、以及从 `gdp` 初始化到生命周期、隐私开关、身份、属性、自定义事件、普通无埋点和敏感值拦截的完整 mock-collector 链路。它不替代 HBuilderX/真机上的页面点击、切后台或截图验证。

开发机启动脱敏 collector：

```sh
pnpm mock:collector
```

collector 默认监听 `127.0.0.1:3100`，并只保存项目 ID、事件类型、数量、字节数、状态和拒绝原因。真机验证时用下列方式显式监听局域网网卡：

```sh
MOCK_COLLECTOR_HOST=0.0.0.0 pnpm mock:collector
```

随后在 `main.ts` 中填写开发机实际局域网 IP（不能填 `0.0.0.0`）、测试账号和数据源。不要直接把 `dataCollect` 改为 `true`；请在运行中的“采集开关”页显式开启，这样可以同时验证 `setOptions({ dataCollect })` 的运行时行为。不得把身份或输入原文写进 demo 日志。

提交前可运行：

```sh
pnpm demo:check
```
