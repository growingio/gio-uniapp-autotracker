# GrowingIO uni-app SDK Showcase

这是传统 uni-app Vue 3 App 的可运行 showcase。它与 uni-app x demo 对齐展示已实现的功能：生命周期、`PAGE` 上下文、自定义事件、用户身份/属性、Vite 无埋点业务交互、路由 query 和 `dataCollect` 动态开关。

默认开启 `dataCollect`，因此首次 `App:onShow` 会创建 `VISIT`，随后在 uploader 真正发起请求前以 Debug JSON 输出。若业务需要等待隐私同意，可在 `sdk-state.ts` 将 `enabled` 设为 `false`（main.ts 与示例页面共用此状态），再通过「采集开关」页开启。SDK 的完整初始化与 App/Page 生命周期接入只在 `main.ts` 里使用小程序同款的 `gdp('registerPlugins')` 与 `gdp('init', ..., { uniVue: app })`；`App.vue` 和各演示页面都不需要 bridge 或 tracker import，业务调用也全部使用 `gdp('xxx')`，不暴露 `$gio` 或内部 tracker。`gioABTest`、微信分享和 `.nvue` 自动采集并非当前传统 App SDK 的能力；首页的“当前能力边界”区会明确说明，绝不伪造成功结果。

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

随后在 `main.ts` 中填写开发机实际局域网 IP（不能填 `0.0.0.0`）、测试账号和数据源。初始状态由 `sdk-state.ts` 统一控制；可在运行中的“采集开关”页先关闭再开启，同时验证 `setOptions({ dataCollect })`。不得把身份或输入原文写进 demo 日志。

提交前可运行：

```sh
pnpm demo:check
```

无埋点页按真机验收顺序分为六组，包含有/无 id 的 click 与 tap、严格主目标、动态 id/metadata、无 id 列表、`v-if` / `v-show`、条件 handler、Options API、`<script setup>`、普通 `setup()` 返回别名、input/textarea 完成事件、所有已支持 change 组件、`uni-link` 与 tabBar。页面会显示业务 handler 执行次数和每项预期 xpath，便于同时确认业务没有被重复调用。此 demo 的 vite.config.ts 显式设置 `__GIO_AUTOTRACK_VERIFICATION__: true`，用于开放三端待验收的无埋点链路；它不会把生产能力表标为已验收，正式应用不要复制。密码、显式 sensitive、currentTarget/target 任一 ignore 和未放行的 autoplay 不生成自动事件。生产开放必须以逐端真机请求和 collector 接收证据为准。

函数引用及条件返回函数等不安全写法不会插桩，条件示例会保留一次预期告警。列表动态元数据从原生 dataset 获取；动态 picker range 回退下标，不能再按显示文案验收。
