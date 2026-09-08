# 核心代码测试与发布前门禁

## 常用命令

在仓库根目录安装锁定依赖后运行：

```sh
pnpm install --frozen-lockfile
pnpm run test:release
```

`test:release` 先进行源码、测试、发布脚本及源码消费者示例的 TypeScript 检查，再运行全部单元、协议和集成测试，并检查核心源码覆盖率。不需要启动 HBuilderX 或连接设备。依赖生成包的两个消费者示例由构建后的 `release:check` 检查，首次运行代码测试无需预先生成 SDK 包。

打包前的完整验收入口：

```sh
pnpm run release:prepare
```

执行顺序为：类型检查 → 全部测试与覆盖率 → 构建 SDK → 生成 npm/uni_modules 压缩包 → 验证产物完整性、隔离安装、消费者类型与 demo。任一步失败立即停止；该命令不会发布 npm 包或创建 GitHub Release。

`release:publish` 在发布既有交付包之前再次检查代码测试及交付包，且实际发布仍仅允许在 GitHub tag 工作流中进行。源码、测试、测试配置或发布流程发生变化后，旧交付包会因构建摘要不匹配而被拒绝。

日常可用 `pnpm test` 快速运行所有测试，或 `pnpm exec vitest run test/unit/uploader.test.ts` 运行指定模块。单模块测试不作为发布前验收结果。

## 核心功能与对应测试

| 功能 | 验证行为 | 主要测试文件（相对仓库根目录） |
|---|---|---|
| 公共 API、配置与插件 | 所有 gdp 命令、非法输入、未初始化调用、重复 init、注册原子性、失败 init 后重试、安装顺序及插件异常隔离 | `test/integration/sdk-public-contract.test.ts`；`test/unit/{public-api,config,plugin-registry,tracker-lifecycle}.test.ts` |
| 启动与采集同意 | 异步恢复顺序、不可变快照、条数/UTF-8 字节上限、生命周期独立缓冲、关闭采集不读取业务值、恢复后 VISIT/PAGE | `test/unit/{bootstrap-buffer,hydration,tracker-event-gate,tracker}.test.ts` |
| 匿名/登录身份 | deviceId 生成、旧格式迁移、加密记录、userId/userKey、切换用户后的会话、清除身份 | `test/unit/{identity,identity-codec,identity-persistence}.test.ts`；`test/integration/sdk-public-contract.test.ts` |
| 会话和事件序列 | 冷启动、后台 30 秒边界、身份/同意变化、序列跨会话恢复、APP_CLOSED 无序列 | `test/unit/{session,event-sequence,session-persistence,meta-persistence}.test.ts`；`test/protocol-contract/event-sequence.fixture.test.ts` |
| App / Page 生命周期 | 入口和页面上下文、页面可见性、卸载、动态标题、方向、后台事件、宿主异常隔离 | `test/unit/{app-lifecycle,page-lifecycle,page-store,app-bridge,page-bridge,uniapp-installer,orientation}.test.ts` |
| 事件协议、属性与位置 | 所有事件类型的字段白名单、公共上下文、属性清洗、0/false、事件名校验、经纬度及清除位置 | `test/unit/{protocol,event-composer,event-dispatcher,location-state}.test.ts`；`test/protocol-contract/*.test.ts` |
| 队列与持久化 | FIFO、容量、字节边界、并发领取、重试状态、损坏记录隔离、写入失败后的后续恢复 | `test/unit/{queue,queue-persistence,persistence-boundaries}.test.ts` |
| 上传与网络 | POST/JSON 协议、200/204 接收、4xx 丢弃、5xx/网络重试、最多 3 个并发、断网保留、超时/取消只结算一次 | `test/unit/{collector,uploader,transport-finalizer,app-request,app-network}.test.ts`；`test/integration/mock-collector.test.ts` |
| 无埋点编译 | Vue AST、三种组件写法、条件分支、参数/this/返回值/异常、幂等性、复杂表达式警告与安全跳过 | `test/unit/{autotrack-vite,autotrack-semantics}.test.ts`；`test/integration/autotrack-hbuilderx.test.ts` |
| 无埋点运行时 | schema、id#eventName、各 change 组件、敏感与 ignore、去重、tabBar、正式能力开关、编译到 HTTP 收集的完整链路 | `test/unit/{autotrack-contract,autotrack-dispatch,capabilities}.test.ts`；`test/integration/autotrack-pipeline.test.ts` |
| 三端宿主装配 | Android/iOS/HarmonyOS 公共 API 到真实 SDK 运行时、协议与受控请求；系统信息、网络和存储降级 | `test/integration/sdk-public-contract.test.ts`；`test/unit/{app-runtime,app-system-context,app-storage}.test.ts` |
| 打包发布 | 失败停止后续步骤、发布前再检查、版本渠道、npm 重试、两种安装包内容与真实消费者导入 | `test/integration/release-gate.test.ts`；`test/unit/{release-policy,npm-publisher}.test.ts`；`scripts/check-{release,package-consumers}.ts` |

## 覆盖率与报告

覆盖范围包括 `index.ts`、`autotrack.ts`、`vite.ts` 和 `core/`、`runtime/`、`platform/`、`autotrack/` 中的全部源码，即使文件没有被测试导入也计入。只有纯类型声明文件 `core/ports.ts` 由 TypeScript 检查替代运行时覆盖率。

每个文件必须达到：行与语句覆盖率 90%、函数覆盖率 85%、分支覆盖率 80%。任一文件不达标就返回非零退出码。配置与阈值使用 [Vitest 3 覆盖率能力](https://v3.vitest.dev/config/#coverage)。覆盖率是防遗漏门槛，不能代替上表中的业务行为断言。

- `coverage/index.html`：逐文件可视报告及未覆盖代码。
- `coverage/coverage-summary.json`：机器可读的覆盖率汇总。
- `test-results/junit.xml`：每个用例的执行结果。

分支推送和 PR 的 `SDK Code Tests` 工作流运行完整 `release:prepare`；tag 的 `Publish SDK` 工作流执行相同门禁。CI 保留报告 14 天。报告属于生成文件，不提交 Git。

## 验证边界

这些测试运行真实 SDK 代码，替换 uni 宿主、时间、存储和网络等外部依赖；HTTP 链路使用本地 mock collector。它们证明代码行为，不代表 Android/iOS/HarmonyOS 真机、签名打包或生产服务端验收。生产平台能力表不会因代码测试通过而自动开启。
