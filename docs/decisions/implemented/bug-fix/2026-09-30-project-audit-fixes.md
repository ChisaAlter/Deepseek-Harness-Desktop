# Decision: 项目审查中的文件、远程、更新与构建修复

Status: implemented

中文 | [English](2026-09-30-project-audit-fixes.en.md)

## Problem

全面审查发现十一项缺陷，用户授权全部修复：Files 适配层遗漏保存保护、选区入聊与统一路径导航；LAN 静态服务畸形请求逃出请求处理器、回环绑定被扩为全网卡、端口与 TLS 设置不兑现；预览 URL 未解码；差量安装失败仍报告成功并锁定退出协调器；归档与构建凭据漏掉内容身份或实际输入；macOS 选择 Windows 安装包。

既有决策审计：[单一面板](../architecture/2026-09-28-single-panel-in-place.md)、[安装恢复](2026-09-29-installation-recovery.md)、[差量更新](../product/2026-09-17-electron-updater-differential-updates.md)、[启动器收尾](2026-09-28-launcher-audit-closeout-fixes.md) 均部分重叠，保留各自的面板、恢复、差量下载与离线快照理由，本记录补充适配边界和失败证据，没有完全取代的记录。视觉反馈先同步设计语言，再修改既有组件。

## Decision

- Files 每次编辑立即保存浏览器草稿，文件页切换保留挂载；关闭由既有 Sidebar close handler 延迟，使用共享 Modal 保存或丢弃，失败保留编辑页与草稿。选区原文进入 composer，文件路径提及保持独立；树与搜索通过 Workspace 的统一 openPath 路由并保留 Session。
- LAN 请求解析、URL 解码和文件读取在请求边界捕获错误，畸形请求返回 400，缺失资产返回 404；监听实参、配对 URL 和快照一致。remotePort 控制回环 daemon 端口并参与重启身份；LAN 静态页仍独立使用 3180。移除未实现的 LAN TLS 开关，显示现有端到端加密、中继 TLS 与 LAN HTTP 的实际范围。
- 预览 URL 按路径段单次解码后交给文件系统权限判断，中文、空格和百分号可访问；编码路径分隔符、穿越与 NUL 仍拒绝。
- electron-updater 保留 blockmap 差量下载与十五分钟预算，显式把取消令牌传入下载 API，仅返回安装器路径。检查目标版本及发布清单 SHA512 后，和整包路径共用协调器 commit 内的可观测 spawn；失败释放 Host 接纳锁、不锁定 committed、不退出、不在同一点击中再启动安装器。终止操作的附属清理在 commit 成功后执行，失败保留服务与清理钩子。
- macOS 选择匹配当前架构的 DMG，允许 universal 与无架构名称的映像；校验后通过系统打开，并提示拖入 Applications。打开映像只表示手动安装入口可用，不表示安装成功，也不退出当前应用。
- 打包生成归档 SHA256 小清单，提取完成戳含实际摘要；同版本等长归档变化刷新运行时，旧戳迁移一次，正常复用只读小清单，替换前流式核验。构建阶段凭据覆盖脚本 helper、vendor 源码、manifest 与真实平台 native 产物，排除生成目录防止循环失效。
- 全量验证另确认 Windows 插件市场回滚快照把已有 junction 复制为需额外权限的 symlink。快照复制在 Windows 截获目录链接，复用 ensureDirectoryLink 创建 junction，不遍历外部 overlay；恢复保持目标身份并拒绝覆盖未知普通目录。

## Alternatives considered

- 文件关闭时强制无提示自动保存：减少交互，但覆盖文件失败与用户想丢弃的编辑无法表达，因此保留现有保存/丢弃确认和独立草稿恢复。
- 为 LAN TLS 新增证书管理与 HTTPS 服务：能提供传输 TLS，但涉及证书分发、信任与真机验收，超出本次修复；移除无效控件并准确披露现状。
- 监听 quitAndInstall 的 error 事件补报失败：保持 updater 安装入口，但 void 返回与异步事件不能证明启动提交，本次保留它的下载器并共用已有 spawn 观察。
- 每次启动重新流式计算整个运行时归档摘要：身份可靠但重复读取大型归档；采用打包摘要清单与提取前核验，旧布局才回退流式计算。

## Consequences

十一项缺陷在所属模块修复，保留现有布局、v2 远程协议、差量下载、任务准入与路径权限检查。浏览器存储不可用时不能承诺跨重载草稿恢复；LAN 页面没有 HTTPS；DMG 仍需用户完成系统安装；源码测试不能代替真实 Windows NSIS 安装、macOS 挂载安装或公网手机配对。

回归覆盖 dirty 草稿、延迟关闭与保存失败、选区与 Session 导航、真实畸形 HTTP、编码文件路径、真实 daemon 端口重启、安装器启动失败后二次准入、跨平台安装包选择、等长归档内容变化和构建输入失效；feature 卡、handbook、vendor 分歧记录与双语配对同批更新。

本轮结果与权限限制见[项目审查修复验证](../../../qa/results/2026-09-30-project-audit-fixes/README.md)。
