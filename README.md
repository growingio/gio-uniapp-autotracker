# gio-uniapp-autotracker

传统 uni-app 数据采集 SDK，首期面向 Vue 3 的 Android、iOS、HarmonyOS `.vue` App。

## 文档

- [全端 Measurement Protocol](./doc/measurement-protocol.md)：唯一的事件字段与端间口径来源。
- [SDK 架构设计](./doc/uniapp-sdk-development.md)：目录、模块边界、依赖方向和运行时数据链。
- [开发计划](./doc/development-plan.md)：按依赖顺序拆分的实施、验证与发布门槛。

仓库根目录就是 SDK 包根目录。`uni_modules/gio-uniapp-autotracker` 仅是使用方工程或发布压缩包中的安装位置，不在本仓库内再嵌套一层。
