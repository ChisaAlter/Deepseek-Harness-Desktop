# Windows Desktop Test Matrix

日期：2026-07-18

目标版本：仓库 `1.0.2` / 当前提交 `6b20791fe`

测试环境：Windows 11 Pro x64 build 26200，Node.js `v24.15.0`，Electron `41.2.0`

## 目标与判定

本矩阵覆盖 ChisaCode Windows 桌面端的 Electron 壳、导出的 App renderer、托管
daemon、工作区和设置功能。每条用例都需要覆盖以下路径：

- 正常路径：首次使用、重复使用、刷新、重启后恢复
- 边界路径：空值、最小值、最大值、超长值、特殊字符、非法路径、重复操作
- 异常路径：进程失败、网络断开、权限拒绝、文件不存在、响应超时、版本不兼容
- 恢复路径：取消、重试、重新连接、回到上一步、关闭再打开、退出后重新启动
- Windows 组合：英文/中文、浅色/深色、普通/最大化/全屏、`C:\` 与 UNC 路径、
  空格和非 ASCII 路径、端口占用、已有 daemon、单实例与多实例

状态约定：`未执行`、`通过`、`失败`、`阻断`、`不适用`。失败必须记录复现步骤、
严重级别、日志或截图证据；阻断必须注明缺失的环境或凭据，不能伪装成通过。

## 测试数据

- 空目录、普通 Git 仓库、未初始化目录、脏工作区、含子模块的仓库
- 路径：`C:\temp\chisacode-test`、带空格路径、中文路径、深层路径、UNC 路径
- 输入：空字符串、单字符、最大长度、换行、Emoji、引号、反斜杠、`..`、控制字符
- Agent：mock provider；真实 provider 仅在存在对应凭据时单独记录
- 网络：daemon 正常、端口占用、daemon 停止、WebSocket 断开、relay DNS 不可用
- 桌面窗口：1200x800、980x720（最小值）、4K 高 DPI、最大化、全屏、多显示器

## 功能测试用例

| ID      | 功能域               | 穷举式测试点                                                                | 预期结果                                     | 状态   |
| ------- | -------------------- | --------------------------------------------------------------------------- | -------------------------------------------- | ------ |
| WIN-001 | 安装                 | NSIS 安装到默认目录、用户选择目录、含空格目录、取消安装                     | 安装完成，快捷方式和卸载入口正确             | 未执行 |
| WIN-002 | 安装                 | x64 安装包在 x64 Windows 上安装并启动                                       | 进程、资源、版本和图标正确                   | 未执行 |
| WIN-003 | 安装                 | zip 解压版直接运行、从只读目录运行                                          | 可启动；不能写安装目录时仍能写 userData      | 未执行 |
| WIN-004 | 安装                 | 首次启动、二次启动、升级覆盖安装                                            | 不丢设置、主机、项目和会话元数据             | 未执行 |
| WIN-005 | 安装                 | 卸载后检查快捷方式、安装目录、用户数据                                      | 只清理安装项；用户数据按产品约定保留/清理    | 未执行 |
| WIN-006 | 启动                 | 缺少 renderer、preload、daemon 依赖文件                                     | 启动失败有明确错误，不静默白屏               | 未执行 |
| WIN-007 | 启动                 | 默认单实例重复启动                                                          | 第二实例复用/唤醒第一实例，不产生重复 daemon | 未执行 |
| WIN-008 | 启动                 | `CHISACODE_DISABLE_SINGLE_INSTANCE_LOCK=1`                                  | 测试模式可启动多实例，状态目录隔离           | 未执行 |
| WIN-009 | 启动                 | 从命令行传入项目路径：相对、绝对、带空格、中文、非法路径                    | 正确打开或显示可理解的错误                   | 未执行 |
| WIN-010 | 启动                 | 启动参数带引号、尾部斜杠、重复参数、未知参数                                | 参数解析不截断、不误打开其他路径             | 未执行 |
| WIN-011 | 启动                 | 断网、代理不可用、relay DNS 不可用时启动                                    | 本地桌面和 daemon 仍可用；远端功能显示离线   | 未执行 |
| WIN-012 | 启动                 | renderer 首屏加载慢、Metro/静态资源暂不可用                                 | 显示加载态或错误态，可重试，不永久白屏       | 未执行 |
| WIN-013 | 窗口                 | 普通窗口显示标题栏、拖拽区、原生控制按钮                                    | 只可拖动空白区域；按钮可点击                 | 未执行 |
| WIN-014 | 窗口                 | 最小窗口 980x720、低于最小值调整、1200x800                                  | 不出现控件重叠、横向溢出或不可操作区域       | 未执行 |
| WIN-015 | 窗口                 | 最大化、还原、最小化、任务栏恢复                                            | 状态正确，renderer 获得 resize 事件          | 未执行 |
| WIN-016 | 窗口                 | 全屏进入、退出、快捷键退出、全屏后切页                                      | 全屏状态和 resizer 正确，不残留标题栏控件    | 未执行 |
| WIN-017 | 窗口                 | 多显示器、DPI 100/125/150/200%、窗口跨屏                                    | 布局和字体清晰，不错位或裁切                 | 未执行 |
| WIN-018 | 窗口                 | 浅色/深色主题切换后窗口背景、标题栏 overlay                                 | native window 与 renderer 主题一致           | 未执行 |
| WIN-019 | 窗口                 | 关闭窗口、Alt+F4、任务栏关闭、系统关机信号                                  | 先通知 renderer，再停止托管 daemon，最终退出 | 未执行 |
| WIN-020 | 窗口                 | daemon 停止失败或已退出时关闭窗口                                           | 仍可退出，日志记录失败，不卡死               | 未执行 |
| WIN-021 | 输入                 | 主窗口右键：普通文本、选中文本、可编辑文本                                  | 复制、粘贴、全选、剪切状态准确               | 未执行 |
| WIN-022 | 输入                 | 拼写错误词：有建议、无建议、加入词典                                        | 菜单内容和操作正确                           | 未执行 |
| WIN-023 | 输入                 | 链接右键：`http`、`https`、`file`、`javascript`、空链接                     | 只允许安全外部 URL；复制和打开行为正确       | 未执行 |
| WIN-024 | 输入                 | 图片右键复制、另存为、下载失败/取消                                         | 操作正确；失败可见且不崩溃                   | 未执行 |
| WIN-025 | 输入                 | 拖入本地文件、文件夹、多个文件、非法 URL                                    | renderer 处理文件拖放；不会导航到 `file://`  | 未执行 |
| WIN-026 | 桌面桥               | preload 暴露 platform、invoke、events、window、dialog、notification、opener | API 形状稳定，未暴露 Node/Electron 原始对象  | 未执行 |
| WIN-027 | 桌面桥               | IPC 正常调用、未知命令、非法参数、renderer 卸载后调用                       | 返回结构化错误或安全失败，无未处理 rejection | 未执行 |
| WIN-028 | 桌面桥               | 非主窗口/伪造 sender URL 调用特权 IPC                                       | 被拒绝并记录安全日志                         | 未执行 |
| WIN-029 | 托管 daemon          | 首次启动自动拉起 daemon，获取 serverId/listen/pid                           | 状态为 running 且 renderer 可连接            | 未执行 |
| WIN-030 | 托管 daemon          | daemon 已运行、重复状态查询、状态轮询慢                                     | 不重复启动；状态最终一致                     | 未执行 |
| WIN-031 | 托管 daemon          | daemon 启动失败、端口 6767 占用、备用端口可用                               | 显示原因；按约定退避或明确阻断               | 未执行 |
| WIN-032 | 托管 daemon          | daemon 崩溃、子进程退出、supervisor 重启                                    | 桌面状态更新，重连后会话可恢复               | 未执行 |
| WIN-033 | 托管 daemon          | Restart daemon：正常、正在运行 agent、重复点击、取消                        | 操作有反馈，状态不丢失，重复操作幂等         | 未执行 |
| WIN-034 | 托管 daemon          | Stop daemon：正常、已停止、非桌面托管 daemon                                | 只停止拥有的 daemon，不误杀其他进程          | 未执行 |
| WIN-035 | 托管 daemon          | 启动/退出时 CHISACODE_HOME、pid、socket、日志读写权限                       | 状态写入隔离目录，权限和清理符合约定         | 未执行 |
| WIN-036 | 主机连接             | 默认 localhost 主机自动连接、断开、重连                                     | 连接状态准确，composer 和页面状态同步        | 未执行 |
| WIN-037 | 主机连接             | 新增直连：host、port、SSL、password、URI、空值和非法值                      | 校验正确；保存后可连接或展示明确错误         | 未执行 |
| WIN-038 | 主机连接             | 修改名称、端点、默认主机、删除当前/非当前主机                               | 导航和数据迁移正确，不误删其他主机           | 未执行 |
| WIN-039 | 主机连接             | 多主机切换、主机不存在、serverId 不匹配                                     | 只显示目标主机数据；异常可恢复               | 未执行 |
| WIN-040 | 配对                 | 粘贴 pairing link：合法、过期、损坏、超长、空白                             | 合法链接建立主机；其他情况拒绝并可重试       | 未执行 |
| WIN-041 | 配对                 | QR 扫描入口在 Windows 桌面上的不可用/替代路径                               | 入口状态符合平台能力，不出现死按钮           | 未执行 |
| WIN-042 | relay                | relay 正常、DNS 失败、TLS 失败、重连、重复 serverId                         | 本地直连不受影响；远端错误可见且不泄漏凭据   | 未执行 |
| WIN-043 | 项目                 | 打开项目：Git 仓库、非 Git、空目录、不存在目录、权限拒绝                    | 正确进入或给出可操作错误                     | 未执行 |
| WIN-044 | 项目                 | 添加项目、重复添加、项目名相同、路径大小写差异                              | 去重与显示名稳定                             | 未执行 |
| WIN-045 | 项目                 | 项目菜单：置顶、资源管理器、重命名、全部已读、批量归档、移除                | 每个菜单项可见、行为独立且可恢复             | 未执行 |
| WIN-046 | 项目                 | 项目重命名：空值、重复名、特殊字符、取消、保存失败                          | 校验和错误反馈正确                           | 未执行 |
| WIN-047 | 工作区               | 创建默认工作区、指定目录、指定分支、无效分支                                | 创建成功或明确失败，不污染主 checkout        | 未执行 |
| WIN-048 | 工作区               | Git worktree：创建、重复、分支冲突、归档、删除、恢复                        | 文件系统、注册表和 UI 一致                   | 未执行 |
| WIN-049 | 工作区               | setup/teardown 脚本：空、合法、失败、含引号、长输出                         | 状态流和错误信息正确                         | 未执行 |
| WIN-050 | 工作区               | 工作区重命名、复制路径/分支、置顶、归档、恢复                               | 持久化正确，导航不跳错                       | 未执行 |
| WIN-051 | 工作区               | 项目/工作区列表加载中、空态、错误、刷新                                     | 不重叠、不闪烁，重试有效                     | 未执行 |
| WIN-052 | 会话                 | 新建会话：空 prompt、普通 prompt、超长、多行、Emoji、命令注入文本           | 输入限制和提交行为正确                       | 未执行 |
| WIN-053 | 会话                 | provider 选择：Claude/Codex/OpenCode/Pi/Kimi Code/Grok Build/ACP/Mock       | 可用性、图标、默认模型和错误提示正确         | 未执行 |
| WIN-054 | 会话                 | provider 不可用、模型缺失、mode 缺失、配置过期                              | 非致命警告，不错误启动                       | 未执行 |
| WIN-055 | 会话                 | model selector：搜索、空搜索、大小写、版本后缀、无结果、收藏                | 选择和收藏持久化正确                         | 未执行 |
| WIN-056 | 会话                 | mode/thinking selector：每个模式、非法值、切换前后草稿                      | 选择正确，草稿字段不丢                       | 未执行 |
| WIN-057 | 会话                 | system prompt、sample prompt、assistant preset 应用/缺 provider/缺 model    | 只填充草稿，不提前启动；警告准确             | 未执行 |
| WIN-058 | 会话                 | 创建 agent 后状态：initializing、idle、running、error、closed               | 状态点、标题、时间线和按钮一致               | 未执行 |
| WIN-059 | 会话                 | mock agent 正常流、慢流、空流、错误、取消、重试                             | UI 可观察，终态可恢复                        | 未执行 |
| WIN-060 | 会话                 | 多 agent 并发创建、切换、同 workspace、多客户端观察                         | 各自状态隔离，流不串线                       | 未执行 |
| WIN-061 | 会话                 | 会话列表搜索、排序、置顶、自动时间更新、手动拖拽排序                        | 只有允许的操作改变顺序                       | 未执行 |
| WIN-062 | 会话                 | 会话重命名：空、重复、取消、保存失败、长标题                                | 显示和持久化一致，标题不溢出                 | 未执行 |
| WIN-063 | 会话                 | 归档、解归档、删除、删除确认、取消、重复点击                                | 级联关系和列表刷新正确                       | 未执行 |
| WIN-064 | 会话                 | agent permission：允许、拒绝、批量、超时、关闭页面后回复                    | 权限状态和 agent 终态正确，可重试            | 未执行 |
| WIN-065 | 会话                 | agent question/form：填写、空值、取消、提交失败、重复提交                   | 表单状态和错误恢复正确                       | 未执行 |
| WIN-066 | 会话                 | agent 计划审批：批准、拒绝、取消、重连后恢复                                | 状态与 timeline 一致                         | 未执行 |
| WIN-067 | composer             | 输入、换行、Enter 提交、Shift+Enter、IME 中文输入、焦点切换                 | 不误提交、不丢字、不丢焦点                   | 未执行 |
| WIN-068 | composer             | slash command：命令列表、搜索、无结果、键盘上下选中、Escape                 | 补全准确，输入内容保留                       | 未执行 |
| WIN-069 | composer             | 文件提及：相对路径、目录、特殊字符、无权限、撤销                            | 补全和发送内容正确                           | 未执行 |
| WIN-070 | composer             | 图片附件：拖放、选择、多个、预览、删除、损坏、超大                          | 预览/发送/失败反馈正确                       | 未执行 |
| WIN-071 | composer             | draft 持久化：切页、切 agent、关闭重启、恢复/清空                           | 草稿隔离且不覆盖其他会话                     | 未执行 |
| WIN-072 | composer             | rewind：菜单、候选消息、确认、取消、失败、恢复 composer                     | timeline 和草稿正确回退                      | 未执行 |
| WIN-073 | workspace tabs       | agent/terminal/file/browser tab 新建、关闭、激活、重命名                    | tab 状态和内容一致                           | 未执行 |
| WIN-074 | workspace tabs       | 关闭当前、关闭左/右/上/下、关闭其他、批量关闭                               | 边界 tab 与焦点选择正确                      | 未执行 |
| WIN-075 | workspace tabs       | tab context menu：复制 resume command、agent id、rename、reload、close      | 所有动作可用且菜单不溢出                     | 未执行 |
| WIN-076 | workspace tabs       | tab 拖动排序、拖入 split pane、无效 drop、取消拖动                          | 只在有效目标改变布局                         | 未执行 |
| WIN-077 | split panes          | 单 pane、左右分栏、多 pane、pane focus、切换和 remount                      | 内容不丢、不串焦点                           | 未执行 |
| WIN-078 | split panes          | 拖动 resize handle：最小、最大、快速往返、窗口 resize                       | 面板尺寸稳定，无负尺寸/重叠                  | 未执行 |
| WIN-079 | workspace navigation | 返回、前进、刷新、深链、未知 workspace/agent                                | 可回到有效页面，错误页可恢复                 | 未执行 |
| WIN-080 | terminal             | 创建 terminal：默认 cwd、指定 cwd、非法 cwd、重名                           | 创建结果和错误正确                           | 未执行 |
| WIN-081 | terminal             | 输入普通字符、中文、Emoji、控制键、组合键、粘贴、多行                       | 输入完整，顺序正确                           | 未执行 |
| WIN-082 | terminal             | capture：空输出、滚动、长输出、ANSI、颜色、宽字符                           | 内容和滚动位置正确                           | 未执行 |
| WIN-083 | terminal             | alternate screen：进入/退出、vim/top/less 类场景、resize                    | 屏幕恢复正确                                 | 未执行 |
| WIN-084 | terminal             | terminal 断开、进程退出、kill、重复 kill、重连恢复                          | 状态和资源清理正确                           | 未执行 |
| WIN-085 | terminal             | Windows shell：PowerShell、cmd、Git Bash 可用性和编码                       | shell 启动符合配置，无乱码                   | 未执行 |
| WIN-086 | terminal             | 终端链接：URL、文件路径、行列号、非法链接                                   | 解析和打开目标正确                           | 未执行 |
| WIN-087 | terminal             | 终端右键菜单：复制、粘贴、全选、外链                                        | 行为与主窗口一致                             | 未执行 |
| WIN-088 | terminal             | 文件拖入 terminal、超大文件、多个文件、目录                                 | 插入路径/拒绝策略正确                        | 未执行 |
| WIN-089 | terminal             | 高速键盘压力、长时间输出、切 pane 期间输出                                  | 不丢帧、不冻结、不无限增长                   | 未执行 |
| WIN-090 | explorer             | 文件树加载、空目录、深层目录、隐藏文件、特殊文件名                          | 展示正确，加载态可恢复                       | 未执行 |
| WIN-091 | explorer             | 展开/收起目录、刷新、切 tab、文件不存在/被删除                              | 状态稳定，错误可见                           | 未执行 |
| WIN-092 | explorer             | 打开文本、二进制、超大文件、未知扩展名、编码错误                            | 正确显示或安全降级                           | 未执行 |
| WIN-093 | explorer             | changes/files/PR 三个 tab，非 Git 仓库和 Git 错误                           | tab 能力按仓库状态显示                       | 未执行 |
| WIN-094 | explorer             | diff：新增、删除、修改、重命名、二进制、超长 diff、滚动                     | 统计和内容一致，无溢出                       | 未执行 |
| WIN-095 | explorer             | PR pane：无 PR、单 PR、多 PR、网络失败、权限失败                            | 状态和操作反馈正确                           | 未执行 |
| WIN-096 | editor               | 打开系统 editor：code/cursor/其他、不可用、路径含空格                       | 命令参数和 cwd 正确                          | 未执行 |
| WIN-097 | browser              | 新建 browser tab、URL 输入、空 URL、非法协议、`about:blank`                 | 只加载允许的 URL                             | 未执行 |
| WIN-098 | browser              | back/forward/reload/stop、加载失败、重定向、hash 导航                       | 工具栏状态准确                               | 未执行 |
| WIN-099 | browser              | webview 分区持久化、清除 partition、重新打开                                | 只清除目标 browser 数据                      | 未执行 |
| WIN-100 | browser              | webview 右键、复制链接、图片下载、DevTools                                  | 安全菜单和功能正确                           | 未执行 |
| WIN-101 | browser              | webview 注入 preload、nodeIntegration、sandbox、dialogs、嵌套 webview       | 安全属性强制生效                             | 未执行 |
| WIN-102 | 设置                 | general：语言、主题、字体/密度、启动行为、保存失败                          | 保存后立即生效，重启保留                     | 未执行 |
| WIN-103 | 设置                 | host page：连接、daemon 状态、重启、日志/诊断、错误恢复                     | 每个按钮可操作，失败有反馈                   | 未执行 |
| WIN-104 | 设置                 | providers：启用/禁用、诊断、install/update/reinstall、命令缺失              | 状态、版本和错误准确                         | 未执行 |
| WIN-105 | 设置                 | custom model：新增、编辑、删除、重复 id、非法 URL/headers                   | schema 校验和持久化正确                      | 未执行 |
| WIN-106 | 设置                 | custom provider：新增、继承、命令模板、测试连接、保存失败                   | 配置不泄漏密钥，错误可见                     | 未执行 |
| WIN-107 | 设置                 | MCP servers：新增、编辑、删除、启用/禁用、重复、非法配置                    | catalog 和 agent 注入状态一致                | 未执行 |
| WIN-108 | 设置                 | skills：同步、安装、卸载、删除、网络失败、版本冲突                          | 操作可重试，状态正确                         | 未执行 |
| WIN-109 | 设置                 | synthetic models：新增、编辑、删除、缺 provider/mode/model                  | 只保存合法引用，警告准确                     | 未执行 |
| WIN-110 | 设置                 | usage statistics：空数据、多个 provider、时间范围、刷新失败                 | 统计无 NaN/错位，失败可恢复                  | 未执行 |
| WIN-111 | 设置                 | keyboard shortcuts：默认、修改、冲突、清空、恢复默认、Windows 快捷键        | 冲突提示正确，快捷键立即生效                 | 未执行 |
| WIN-112 | 设置                 | projects：项目选择、项目设置、脚本、worktree setup/teardown                 | 保存、执行、失败和刷新正确                   | 未执行 |
| WIN-113 | 设置                 | integrations：安装 CLI、PATH 已有/缺失、重启 shell、重复安装                | 可验证安装结果，不污染其他 PATH              | 未执行 |
| WIN-114 | 设置                 | updates：无更新、有更新、下载、取消、安装失败、重启                         | 更新状态和提示正确                           | 未执行 |
| WIN-115 | 文件/下载            | 复制文本、复制代码、下载文本、下载图片、取消/权限失败                       | 文件内容和路径正确                           | 未执行 |
| WIN-116 | 文件/附件            | attachment store：新增、读取、删除、重启恢复、损坏索引                      | 不丢文件，不访问越界路径                     | 未执行 |
| WIN-117 | 语音                 | dictation：可用 provider、取消、重试、插入、插入并发送                      | 状态机和音频资源正确                         | 未执行 |
| WIN-118 | 语音                 | 无麦克风、无模型、无 key、设备拒绝、网络中断                                | 明确不可用，不阻塞文字输入                   | 未执行 |
| WIN-119 | 通知                 | 支持性检测、发送通知、点击通知深链、重复通知、关闭窗口                      | 通知和导航正确；平台不支持时降级             | 未执行 |
| WIN-120 | 国际化               | 中英文切换覆盖所有菜单、错误、空态、快捷键、窗口标题                        | 无缺失 key、乱码、硬编码混入                 | 未执行 |
| WIN-121 | 兼容性               | 新 desktop + 旧 daemon、旧 app + 新 daemon、缺少 optional feature           | 兼容策略生效，协议不崩溃                     | 未执行 |
| WIN-122 | 安全                 | 外部 URL、file URL、javascript URL、恶意 webview、伪造 IPC sender           | 所有危险路径拒绝                             | 未执行 |
| WIN-123 | 安全                 | 路径穿越：项目、附件、工作区、脚本、terminal cwd、下载目标                  | 越界访问拒绝，不改写外部文件                 | 未执行 |
| WIN-124 | 安全                 | 日志、错误、诊断、provider 配置中检查 token、password、API key              | 只显示脱敏值                                 | 未执行 |
| WIN-125 | 可靠性               | renderer 崩溃恢复、daemon 重启、WebSocket 重连、窗口重新打开                | 数据和当前选择按约定恢复                     | 未执行 |
| WIN-126 | 性能                 | 冷启动、热启动、空 workspace、100+ sessions、长 timeline、长 terminal 输出  | 不出现不可接受卡顿、泄漏或崩溃               | 未执行 |
| WIN-127 | 可访问性             | 键盘 Tab 顺序、Enter/Space、Escape、焦点可见、按钮名称、菜单关闭            | 核心流程无需鼠标也可完成                     | 未执行 |
| WIN-128 | 可访问性             | 缩放 100/125/150/200%、高对比度、系统字体放大                               | 文本不截断、按钮不重叠                       | 未执行 |

## 已有自动化覆盖映射

仓库现有自动化不是本矩阵的替代品，而是可复用的执行证据：

- Electron/桌面包：`packages/desktop/src/**/*.test.ts`、
  `packages/desktop/scripts/smoke-packaged-desktop-app.test.ts`
- Electron renderer：`packages/app/e2e/desktop-updates.spec.ts`、
  `workspace-open-in-editor.spec.ts`、`terminal-protocol-query.spec.ts`
- 工作区/会话/终端/设置：`packages/app/e2e/*.spec.ts`
- App 纯逻辑和协议边界：`packages/app/src/**/*.test.ts(x)`、
  `packages/protocol/src/**/*.test.ts`、`packages/client/src/**/*.test.ts`

执行时必须把自动化结果与本矩阵 ID 对齐；“有测试文件”不等于“Windows 真实端已通过”。

## 执行记录

| 批次 | 命令/操作                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | 覆盖 ID                                                                                                                                                                   | 结果                              | 证据                                                                                                                                                                                            |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0    | 环境盘点                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | WIN-001..WIN-128 前置条件                                                                                                                                                 | 完成                              | Windows 11 Pro x64 build 26200、Node v24.15.0、Electron 41.2.0；隔离 CHISACODE_HOME                                                                                                             |
| 1    | `npm run test --workspace=@chisacode/desktop`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | WIN-006, WIN-026..035, WIN-101, WIN-121..125                                                                                                                              | 通过                              | 23 个测试文件、194 条测试全部通过                                                                                                                                                               |
| 2    | `npm run typecheck --workspace=@chisacode/desktop`；`npm run lint -- packages/desktop`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | WIN-006, WIN-026..028, WIN-121..124                                                                                                                                       | 通过                              | typecheck 通过；lint 0 warning / 0 error                                                                                                                                                        |
| 3    | `node packages/desktop/scripts/smoke-packaged-desktop-app.js --app packages/desktop/release/win-unpacked`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | WIN-002, WIN-007, WIN-029..035, WIN-080..085                                                                                                                              | 通过                              | packaged Electron、托管 daemon、CLI shim、terminal create/send/capture、daemon stop 均完成                                                                                                      |
| 4    | Windows 原生目录选择器 + packaged Electron 人工测试                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | WIN-013, WIN-015, WIN-018, WIN-029, WIN-035, WIN-036, WIN-043, WIN-051, WIN-057, WIN-067, WIN-073, WIN-077, WIN-094, WIN-102, WIN-103, WIN-110, WIN-114, WIN-120, WIN-122 | 通过                              | 项目 `C:\Ai\ChisaCode` 打开；Git `cn-main`；设置 12 分区；主题/语言；tab、split、diff、browser 均可操作                                                                                         |
| 5    | packaged Electron UI：provider/preset/composer 边界                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | WIN-053..057, WIN-067                                                                                                                                                     | 失败/阻断                         | 预设可填充草稿；未配置模型时发送调用超过 30 秒且无可见错误；真实 provider 无凭据                                                                                                                |
| 6    | packaged Electron UI：terminal/browser/environment panel                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | WIN-073..085, WIN-097..101                                                                                                                                                | 通过                              | terminal 默认 `cmd.exe`、cwd 为 `C:\Ai\ChisaCode`；browser 支持 `about:blank`、前进后退并拦截 `javascript:`；split 和 panel tabs 可用                                                           |
| 7    | packaged Electron settings/host/diagnostics                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | WIN-102..114, WIN-124..126                                                                                                                                                | 失败/阻断                         | 主题语言、Host 状态和版本页可用；诊断响应约 31 秒，daemon status 约 4.8 秒；relay/provider/voice 条件不可用                                                                                     |
| 8    | `npx playwright test e2e/settings-navigation.spec.ts e2e/settings-host-page.spec.ts e2e/desktop-updates.spec.ts --project="Desktop Chrome"`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | WIN-102..114, WIN-121, WIN-125                                                                                                                                            | 5 通过、18 失败                   | 23 条 spec；多数失败为测试定位器/英文文案与当前实现不一致，详见 WD-008                                                                                                                          |
| 9    | `npx playwright test e2e/terminal-protocol-query.spec.ts e2e/workspace-open-in-editor.spec.ts e2e/file-explorer-collapse.spec.ts --project="Desktop Chrome" --max-failures=6`                                                                                                                                                                                                                                                                                                                                                                                                                                                             | WIN-073..096                                                                                                                                                              | 3 失败                            | terminal tab、file explorer、editor target 均在 harness 选择器阶段超时；Git watcher 出现 `EPERM`                                                                                                |
| 10   | `npx playwright test e2e/composer-autocomplete.spec.ts --project="Desktop Chrome" --max-failures=2`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | WIN-068, WIN-127                                                                                                                                                          | 4 通过、2 失败                    | slash 命令弹层首帧、筛选、尺寸锚定检查通过；桌面 sidebar 与移动 `Open menu` 定位器不匹配当前 UI，不能作为产品失败判定；同批仍观察到 `fetch_agent_history` 约 0.9~20.3 s 与 Git watcher `EPERM`  |
| 11   | `npx playwright test e2e/composer-attachments.spec.ts --project="Desktop Chrome" --max-failures=4`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | WIN-070, WIN-116, WIN-123                                                                                                                                                 | 4 失败后停止、8 未运行            | 临时项目 sidebar 定位器失配；GitHub issue/PR fixture 的 clone 目标目录冲突；附件断言未形成有效产品证据；测试失败命令日志曾包含凭据，已删除临时日志                                              |
| 12   | `npx playwright test e2e/agent-idle-status.spec.ts e2e/agent-stream-ui.spec.ts --project="Desktop Chrome" --max-failures=3`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | WIN-058, WIN-059                                                                                                                                                          | 1 通过、3 失败                    | idle 终态回放通过；stream UI 3 条在旧 `stop/cancel` 或临时项目 sidebar locator 阶段失败；daemon 已观察到 `agent_stream`、`turn_completed`、`attention_required`                                 |
| 13   | `npx playwright test e2e/archive-tab.spec.ts e2e/sidebar-workspace-rename.spec.ts e2e/workspace-agent-tab-rename.spec.ts e2e/workspace-navigation-regression.spec.ts --project="Desktop Chrome" --max-failures=5`                                                                                                                                                                                                                                                                                                                                                                                                                         | WIN-050, WIN-062, WIN-063, WIN-073, WIN-079, WIN-125                                                                                                                      | 4 通过、5 失败、2 未运行          | archive tab 三条与 Agent tab 重命名通过；其余失败集中在临时项目 sidebar hydration、离线文案与 reconnect 前置 locator；无新的已确认产品缺陷                                                      |
| 14   | `npx playwright test e2e/terminal-alternate-screen.spec.ts e2e/workspace-layout-prototype.spec.ts e2e/workspace-pane-remount.spec.ts e2e/workspace-cwd.spec.ts e2e/launcher-tab.spec.ts --project="Desktop Chrome" --max-failures=5`                                                                                                                                                                                                                                                                                                                                                                                                      | WIN-073..085, WIN-089, WIN-126                                                                                                                                            | 5 通过、5 失败、2 跳过、5 未运行  | 部分 tab/layout/cwd/no-flash 通过；terminal tab 在 harness 中未出现导致创建/alternate-screen 断言未执行；性能 spec 按设计跳过；仍观察到 renderer 结构错误                                       |
| 15   | `npx vitest run --bail=1 src/keyboard/shortcut-string.test.ts src/keyboard/route-shortcut.test.ts src/attachments/local-file-attachment-store.test.ts src/attachments/service.test.ts src/attachments/web/indexeddb-attachment-store.test.ts src/desktop/permissions/desktop-permissions.test.ts src/composer/submit.test.ts src/composer/actions.test.ts src/composer/github/auto-attach.test.tsx`                                                                                                                                                                                                                                       | WIN-021..028, WIN-067..071, WIN-115..119, WIN-122..124, WIN-127                                                                                                           | 8 文件、111 测试通过              | 快捷键、附件存储/编码、composer 发送/队列、GitHub 自动附加和桌面权限逻辑通过；属于逻辑层补充证据，不替代 packaged UI                                                                            |
| 16   | `npx vitest run --bail=1 src/utils/path.test.ts src/utils/worktree.test.ts src/server/worktree-branch-name-generator.test.ts src/server/resolve-worktree-creation-intent.test.ts src/server/worktree-bootstrap.test.ts src/server/session.workspace-resolution-invariants.test.ts src/server/session.workspaces.test.ts src/server/agent/permission-response.test.ts src/server/agent/agent-event-forwarder.test.ts src/server/agent/agent-projections.test.ts src/server/agent/create-agent-mode.test.ts src/server/agent/providers/provider-windows-launch.test.ts src/terminal/terminal.test.ts src/terminal/terminal-manager.test.ts` | WIN-047..050, WIN-058..066, WIN-080..089, WIN-121..125                                                                                                                    | 13 文件、199 通过、23 跳过        | Windows 路径/worktree、workspace 解析、权限/计划响应、provider Windows 启动、terminal 生命周期通过；跳过项为平台/环境条件，不记为通过                                                           |
| 17   | 静态检查 `packages/desktop/release`：`latest.yml` 哈希/尺寸、x64/arm64 NSIS 与 ZIP、ZIP 内容、PE 版本/签名                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | WIN-001..005, WIN-002, WIN-114, WIN-121, WIN-124                                                                                                                          | 哈希/尺寸和打包内容通过；签名失败 | x64/arm64/通用安装器版本均为 1.0.2，`latest.yml` 三个 EXE 的 SHA-512 与尺寸全部匹配；ZIP 含 `app.asar`、`app-dist`、Windows `node-pty`、shell integration；安装器和 unpacked EXE 均 `NotSigned` |
| 18   | `npx playwright test e2e/workspace-setup-runtime.spec.ts e2e/workspace-setup-streaming.spec.ts --project="Desktop Chrome" --max-failures=5`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | WIN-047..049, WIN-080..085, WIN-112                                                                                                                                       | 1 通过、5 失败、3 未运行          | daemon 观察到 `workspace_setup_progress` 与 `checkout_status_update`；UI 多次卡在临时项目 sidebar hydration，失败 setup 的 progress 监听也超时；未形成完整桌面 UI 通过                          |

## 最终状态判定

以下判定按已实际执行的场景记录。只有自动化/人工证据覆盖到的场景才列入判定；“通过”表示已执行场景未发现问题，不代表该功能行的所有边界组合已经穷举完成。未列出的 ID 保留为`未执行`。

| 状态   | 用例 ID                                                                                                                                                                                                                         | 判定依据                                                                                                                                       |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 通过   | WIN-013, WIN-015, WIN-018, WIN-026, WIN-029, WIN-030, WIN-035, WIN-036, WIN-043, WIN-051, WIN-057, WIN-067, WIN-073, WIN-077, WIN-080, WIN-082, WIN-094, WIN-097, WIN-098, WIN-101, WIN-102, WIN-103, WIN-110, WIN-120, WIN-122 | 真实 packaged Windows UI 或桌面单元/烟测证据覆盖已执行场景，且未观察到失败                                                                     |
| 失败   | WIN-033, WIN-054, WIN-124, WIN-125, WIN-126                                                                                                                                                                                     | daemon restart 无明确状态反馈；无模型发送路径超时；诊断/状态请求慢；renderer 错误和慢请求可复现                                                |
| 阻断   | WIN-041, WIN-042, WIN-053, WIN-085, WIN-104, WIN-117, WIN-118, WIN-119, WIN-128                                                                                                                                                 | Windows QR/相机替代路径、relay DNS、真实 provider、PowerShell/Git Bash 独立验证、provider 安装、语音、通知点击、DPI/多显示器缺少可用环境或凭据 |
| 未执行 | 其余 89 条                                                                                                                                                                                                                      | 当前环境没有安全、稳定或完整的测试数据/凭据，不能冒充通过                                                                                      |

**统计：** 39/128 条已形成最终判定，其中通过 25、失败 5、阻断 9；其余 89 条尚未形成完整 Windows 端最终判定。补充自动化批次共选取 88 条 E2E：19 通过、46 失败、2 跳过、21 未运行；失败不能直接等价为产品缺陷，其中大部分是定位器、语言契约、桌面桥接模拟、Git fixture 或临时目录 watcher 问题。另有 app 逻辑层 111 条、server 边界层 199 条测试通过，但没有把它们冒充 packaged UI 的完整通过。

补充通过证据未升级为最终“通过”的原因：一条矩阵用例包含多个边界组合，单个单测或 browser harness 只覆盖其中一部分；而且仓库 Playwright 运行的是 Chromium supplemental surface，Windows packaged Electron 人工/烟测才是桌面端最终判定依据。

## 缺陷记录

| 缺陷 ID | 严重级别 | 关联用例                           | 现象                                                                                                                                                  | 复现/证据                                                                                                                                       | 状态                 |
| ------- | -------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| WD-001  | P2       | WIN-026, WIN-126                   | `dev.ps1` 注入 `--remote-debugging-port=9223`，但 `main.ts` allowlist 拒绝该 flag，开发端 9223 不监听                                                 | 日志：`rejected non-allowlisted flags: [ '--remote-debugging-port=9223' ]`                                                                      | 待修复               |
| WD-002  | P2       | WIN-054                            | 未配置 provider/model 时点击发送，自动化调用超过 30 秒；应用仍可见但没有明确“缺少模型”错误或终态反馈                                                  | packaged UI；Playwright click 超时；composer 内容仍保留                                                                                         | 待修复               |
| WD-003  | P2       | WIN-033, WIN-125                   | Host 页面点击“重启”后没有 loading、断开/重连反馈，页面 PID 未在可观察窗口内变化                                                                       | packaged Host 页显示 `运行中` / `PID 43652`，点击后仍为同一可见状态                                                                             | 待复核               |
| WD-004  | P2       | WIN-124, WIN-126                   | 诊断请求约 31,021 ms；daemon status 约 4,826 ms；file explorer 约 2,764 ms；多个 provider snapshot 约 1,746 ms                                        | daemon.log `diagnostics.response`、`ws_slow_request`                                                                                            | 待优化               |
| WD-005  | P2       | WIN-073, WIN-077, WIN-090..096     | workspace 页面出现 React/DOM 结构错误：嵌套 Pressable/button、`uniProps`/ThemedListTree 错误、焦点 `aria-hidden` 警告                                 | Metro/E2E 日志：`workspace-desktop-tabs-row.tsx:746`、`context-menu.tsx:348`、`workspace-header.tsx:498`、`workspace-environment-panel.tsx:326` | 待修复               |
| WD-006  | P2       | WIN-121, WIN-127                   | 当前 app E2E 26 条中 21 条失败；断言仍使用 `Open menu`、`Manage built-in daemon`、`Connections`、`Add connection` 等未匹配当前中文/组件契约的 locator | Playwright 结果：settings/desktop-updates 18 失败，terminal/editor/explorer 3 失败                                                              | 待维护测试           |
| WD-007  | 阻断     | WIN-042                            | `relay.chisacode.sh` DNS `ENOTFOUND`，无法验证远端 relay、配对和通知深链                                                                              | daemon.log 多次 `getaddrinfo ENOTFOUND relay.chisacode.sh`                                                                                      | 环境阻断             |
| WD-008  | 阻断     | WIN-117, WIN-118                   | speech runtime 没有可用本地模型、OpenAI STT/TTS 或有效 key；实际 provider 均为 unavailable                                                            | E2E/daemon 日志：`effectiveProviders: unavailable`                                                                                              | 环境阻断             |
| WD-009  | 已知降级 | WIN-006, WIN-035, WIN-125          | `better-sqlite3` native binding 缺失，agent index disabled，回退 JSON storage                                                                         | daemon 日志明确记录 fallback；JSON storage 继续工作                                                                                             | 已接受，需打包验证   |
| WD-010  | P2       | WIN-090, WIN-126                   | 临时 Git 仓库 watcher 在 Windows 下多次 `EPERM: operation not permitted, watch`，导致 explorer/terminal/editor E2E 无法完成                           | E2E daemon 日志，watch path 为临时仓库 `.git\HEAD`                                                                                              | 待复核               |
| WD-011  | P2       | WIN-001, WIN-002, WIN-114, WIN-124 | 当前 x64/arm64/通用 Windows 安装器和 unpacked EXE 均未通过 Authenticode 签名校验；用户可能看到 SmartScreen/未知发布者警告，更新链的信任边界也不完整   | `Get-AuthenticodeSignature` 返回 `NotSigned`；静态哈希/尺寸本身匹配 `latest.yml`                                                                | 待签名或明确发布豁免 |

## 结论规则

- P0/P1 失败：Windows 端不能判定通过
- P2 失败：必须记录风险和是否允许发布
- 真实 provider、真实麦克风、通知点击、DPI/多显示器若当前环境不可用，记录为`阻断`，不能记为通过
- 最终总结至少包含：执行数量、通过/失败/阻断数量、P0-P2 缺陷、自动化覆盖、人工未覆盖项、发布建议

## 本轮结论

- 发布判定：**不建议发布 Windows 端**。存在 6 条 P2 风险（含当前安装器未签名的 WD-011），且 relay、语音、DPI/通知等关键能力仍阻断；同时 renderer 结构错误和慢请求需要修复或明确豁免。
- 已确认可用：packaged Electron 冷启动、托管 daemon、本地 Host、Git 项目打开、设置导航、主题/语言、Agent 预设草稿、terminal/browser/split/diff 基础流程。
- 发布前必须补测：安装/升级/卸载、代码签名与 SmartScreen、单实例/窗口关闭恢复、端口冲突、真实 Agent 流、权限/问题表单、附件下载、通知点击、DPI/多显示器、PowerShell/Git Bash、relay 和语音。
- 自动化门禁：先修正 WD-006 的测试契约和 WD-010 的 Windows watcher 问题，再重新运行相关 E2E；不能以当前 5/26 通过率作为产品质量结论，也不能忽略实际 packaged UI 的 WD-002..005。
