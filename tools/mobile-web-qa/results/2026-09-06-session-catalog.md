# 会话归档与公网目录差异

## 已确认原因

- 本机运行数据的 12 个归档 ID 都有日志，但不在当前工作区成员表中。其中 8 个属于仍登记的 ChisaTerminal，另 4 个属于未登记的旧测试目录。检查仅读取 header，不修改用户日志或归档状态。
- 两个当前工作区的日志共 118 条，成员表仅记录 28 条。启动只校验原成员，没有补入其余历史；显示归档开关无法覆盖成员筛选。
- 2026-09-06 从公网取得的 `host/catalog.js` 缺少本地已有的成员资格筛选。真实浏览器导入线上模块后，相同测试数据在线上多出 `removed` 和 `removed-archive`，本地结果正确。不是凭文件哈希差异推定行为。

## 修复与验证

- Host 启动复用 header 索引为现有登记补全历史成员，包括归档会话；不复建已删除工作区，不改变归档集合。
- 侧栏组件回归覆盖界面设置开关的即时显隐、分组和单列表模式、默认折叠、归档行不打开会话。
- 定向命令：在 vendor/deepseek-harness 下运行 `node node_modules/vitest/vitest.mjs run packages/workspace/workspace packages/api/workspace-controller packages/client/ui-workspace`。
- 桌面/远程目录命令：`node --test "mobile/web/host/*.test.js" src/shared/dshd-host-tunnel.test.js src/shared/harness-desktop-forks.test.js`。
- 类型检查：在 vendor/deepseek-harness 下运行 `node node_modules/typescript/bin/tsc -b packages/workspace/workspace/tsconfig.json`。
- 最终结果：Harness 定向 262/262、桌面/远程目录 114/114、类型检查和本地浏览器目录检查通过。
- 本地浏览器目录检查：`node tools/mobile-web-qa/run-catalog-parity-qa.mjs`。需要 `playwright-core` 和本机 Chrome/Edge；可通过 `NODE_PATH` 使用已有 QA 依赖。
- 部署后检查：`node tools/mobile-web-qa/run-catalog-parity-qa.mjs http://125.124.85.212:3389/dshd/`。部署前本地 Pass、公网 Fail；必须在部署后变为两端 Pass 才可宣称修复线上。

## 公网部署

2026-09-06 用户提供服务器配置后，使用本机现有 SSH 密钥连接并完成定向发布。服务器只接受 publickey；没有开启密码登录，也没有改动 SSH 配置。

- 仅发布 `/var/www/dshd-app/host/catalog.js`，并修改线上 `app.js` 的目录模块引用、`index.html` 的 app 引用；线上其余代码保留。
- 缓存版本：`20260906T034605Z`。备份目录：`/var/backups/dshd-catalog-20260906T034605Z`。
- 发布前校验三个原文件的 SHA-256，暂存内容读回一致后逐文件原子替换；公网 HTTP 读取的三个文件与已发布内容哈希一致。
- 真实浏览器模块复测：本地 Pass、公网 Pass；普通和已归档的已移除工作区会话均不再被列出。
- 未重启中继，未修改 nginx 配置、配对记录或会话日志。部署凭据只保存在本机用户级加密文件，不记录于仓库。

## 未完成边界

没有替换正在运行的安装版或修改其会话数据；安装版仍需要包含此次 Host 修复的新构建。未执行双端真实会话全流程验收，不把隔离 fixture 记为实机 Pass。

文档格式全库检查被既有 Agent Notes 的格式错误阻断；本次新增 Note 未被报告，两个修改的双语文档对定向检查通过。
