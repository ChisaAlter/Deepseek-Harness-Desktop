# 远程 Web / Android 本地恢复回归

日期：2026-09-05。Feature：`mobile-remote`。

## 交付边界

用户要求 Android 实机先跳过、不发布，留待后续版本。本报告的追加修复仅保留在源码和本地 Debug APK，不部署、不安装、不重启桌面。临时替换的 `dist/win-unpacked` host tunnel 模块已恢复为本轮替换前备份。

此前公网三文件首连修复见 `2026-09-05-connect.md`，不代表本报告的追加修复已经上线。

## 原因与修复

- 首次握手失败被无限自动重试遮蔽：首次成功前禁止自动重连，失败关闭客户端并释放按钮；新 offer 取消旧尝试，过期 offer 在传输建立前拒绝。
- 配对成功只保存 deviceSecret，活客户端却仍保留已消费 pairingToken：立即更新活客户端认证记录。真实 bundled DaemonClient 的受控断网测试先复现失败，再验证第二次 hello 使用 secret proof 而非一次性令牌。
- 公网 session.list 实测约 473477 字节，耗时约 12.7 至 29.8 秒，部分触发 30 秒超时；其中 projections 约 434563 字节。host tunnel 仅保留目录所需投影，不删除会话行、不改变 history 详情。回归覆盖实际 forwardHostRpc 路径，验证不修改原对象。
- 增加目录失败重试、前台连接探测和重连后同步；取消或被替代连接的结果不得覆盖当前状态。
- Android 同步共享 SPA 修复，增加显式导航请求序号、消费后 fragment 保持清除、前后台事件和主页面错误处理；WebView 销毁由单一生命周期 effect 负责。
- 更新假 host 的命令接口和旧浏览器选择器，保留原业务断言；增加目录失败重试用例。

## 本地验证

- `node --test mobile/web/**/*.test.js mobile/web/*.test.js src/shared/dshd-host-tunnel.test.js src/shared/dshd-mux-sse.test.js`：303/303。
- `tools/mobile-web-qa/run-qa.mjs`：30/30，Edge headless，假 host。
- `tools/mobile-web-qa/run-connect-qa.mjs`：390px / 1280px 均通过，覆盖失败清理、凭据保留、重试被新 offer 替代、成功进入聊天和 fragment 清除。
- `gradlew.bat :protocol:test :app:testDebugUnitTest :app:assembleDebug`：BUILD SUCCESSFUL，Java 17。

## 未验收

- 目录瘦身后的真实公网性能尚未验证，不能把受控响应体缩减当作公网测速结果。
- Android 实机、网络切换和厂商 WebView 行为按用户要求延后。
- 本地通过不等于远程全功能实机验收；产品停放及既有 DEFER 保持不变。
