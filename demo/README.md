# 生命周期 demo

这是传统 uni-app Vue3 App 的最小宿主，已通过 App / Page bridge 接入 SDK runtime。默认 `dataCollect: false`，因此启动不会产生或发送采集事件。

开发机启动脱敏 collector：

```sh
pnpm mock:collector
```

collector 默认监听 `127.0.0.1:3100`，并只保存项目 ID、事件类型、数量、字节数、状态和拒绝原因。真机验证时用下列方式显式监听局域网网卡：

```sh
MOCK_COLLECTOR_HOST=0.0.0.0 pnpm mock:collector
```

随后在 `analytics.ts` 中填写开发机实际局域网 IP（不能填 `0.0.0.0`）、测试账号和数据源，并将 `dataCollect` 改为 `true`。不得把身份或输入原文写进 demo 日志。
