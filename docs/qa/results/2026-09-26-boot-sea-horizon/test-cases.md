# 启动页穷举测试用例表（实机驱动 headless Edge + shell stub）

| # | 用例 | 预期 | 实测 | 结果 |
|---|---|---|---|---|
| TC-01 | 初始 getState=starting | data-state=starting；状态「启动中」；省略号可见 | ["starting","启动中","inline-flex"] | ✅ |
| TC-02 | idle 态 | status「待机」，省略号收起，无 hint/actions | ["待机","none",true,true] | ✅ |
| TC-03 | ready 态 | status「就绪」+ hint「正在打开 Web UI。」 | ["就绪","正在打开 Web UI。"] | ✅ |
| TC-04 | stopping 态 | status「正在停止」+ hint「正在停止运行时。」 | ["正在停止","正在停止运行时。"] | ✅ |
| TC-05 | error(startup) 态 | 「桌面端启动失败」+ ENOENT 诊断文案；actions 展开：重试可用/回启动器排查可见/下载日志可见/取消重启隐藏 | ["桌面端启动失败","桌面运行时文件缺失，请重新安装桌面端。（详情见下方日志）",false,false,false,false,true] | ✅ |
| TC-06 | error+恢复已排程 | 取消自动重启可见；回启动器排查隐藏；恢复文案含「秒后进行」 | [false,true,"60 秒后进行第 1/3 次自动重启。"] | ✅ |
| TC-07 | error+恢复重启中 | 重试禁用；取消重启禁用；回启动器隐藏 | [true,true,true] | ✅ |
| TC-08 | runtime 阶段失败 | 「桌面端意外退出」+ 恢复页 hint + 重试文案「立即重启」 | ["桌面端意外退出","桌面端已返回恢复页面，失效的 Web UI 和手机 Remote 已停止使用旧进程。","立即重启"] | ✅ |
| TC-09 | 恢复耗尽 | 文案「已完成 3 次自动重启，仍未稳定运行。自动恢复已停止。」 | "已完成 3 次自动重启，仍未稳定运行。自动恢复已停止。" | ✅ |
| TC-10 | 恢复已取消 | 文案「本轮自动恢复已取消。」 | "本轮自动恢复已取消。" | ✅ |
| TC-11 | skipUserPlugins 恢复文案 | status=BootRecovery.skipStartingCopy().status；class=status ready | ["正在以官方组合启动","status ready","正在以官方组合启动"] | ✅ |
| TC-12 | 插件装载进度 | 「正在加载插件 2/5」 | "正在加载插件 2/5" | ✅ |
| TC-13 | 插件装载失败 | 「插件加载失败」+ data-state=error + hint=错误 | ["插件加载失败","error","插件装载炸了"] | ✅ |
| TC-14 | 未知 state 回退 | status 回退「启动中」 | "启动中" | ✅ |
| TC-15 | 日志进账 | ticker=最新行；L 03；抽屉计数 3 行 | ["[t] line-three","L 03","3 行"] | ✅ |
| TC-16 | 点击 ticker 开抽屉 | logdrawer hidden=false | false | ✅ |
| TC-17 | Enter 开抽屉 | hidden=false | false | ✅ |
| TC-18 | Space 开抽屉 | hidden=false | false | ✅ |
| TC-19 | × 关抽屉 | hidden=true | true | ✅ |
| TC-20 | 点遮罩关抽屉 | hidden=true | true | ✅ |
| TC-21 | Escape 关抽屉 | hidden=true | true | ✅ |
| TC-22 | 抽屉已关再按 ESC | 保持 hidden=true | true | ✅ |
| TC-23 | 抽屉开着时新行实时追加 | li 数 +1 且抽屉仍开 | [4,false] | ✅ |
| TC-24 | 重要行标红 | 末行 li.important + ticker.important | ["important","ticker-line important"] | ✅ |
| TC-25 | 日志上限 400 | 泛洪 500 行后 li 数=400，计数 L 400 | [400,"L 400"] | ✅ |
| TC-26 | 非字符串日志行 | String() 兜底渲染不崩 | "[object Object]" | ✅ |
| TC-27 | 日志 XSS 注入 | onerror img 作为纯文本渲染（子元素 0） | 0 | ✅ |
| TC-28 | 重试动作 | 调用 shell.restart；先切 starting | [["restart"],"starting"] | ✅ |
| TC-29 | 重试失败路径 | shell.restart 拒绝 → error + failure 文案 | ["error","启动失败，请下载日志后回启动器排查。"] | ✅ |
| TC-30 | 取消自动重启失败路径 | 调用 cancelRestart；拒绝 → 「取消失败：」恢复文案 + 按钮恢复可用 | [["cancelRestart"],"60 秒后进行第 1/3 次自动重启。 取消失败：cx-fail",false] | ✅ |
| TC-31 | 回启动器排查失败路径 | 调用 openLauncher；拒绝 → 「打开启动器失败：」+ 按钮恢复 | [["openLauncher"],"打开启动器失败：ol-fail",false] | ✅ |
| TC-32 | 下载日志成功 | 「日志已保存：C:/x/boot.log」 | "日志已保存：C:/x/boot.log" | ✅ |
| TC-33 | 下载日志失败 | 「保存日志失败：io fail」 | "保存日志失败：io fail" | ✅ |
| TC-34 | 下载日志被取消 | 取消不清空上一条 actionNotice（保留 io fail 提示，属既定契约） | "保存日志失败：io fail" | ✅ |
| TC-35 | 离开 error 清 actionNotice | recovery 区归空 hidden | [true,""] | ✅ |
| TC-36 | 主题明暗切换 | dark 置位 data-ds-dark-theme；light 移除 | [true,false] | ✅ |
| TC-37 | boot 主题不吃壁纸 seed | applyTheme(bg) 后 --dsw-alias-bg-base 被清除 | "" | ✅ |
| TC-38 | harness 遮盖契约 | data-harness-covered 时 .scene visibility:hidden | "hidden" | ✅ |
| TC-39 | 最大化去圆角 | maximized 时 scene border-radius=0px | "0px" | ✅ |
| TC-40 | 窗控最小化 | 调用 windowAction("minimize") | ["windowAction"] | ✅ |
| TC-43 | 快照不得截断流式缓冲（P1 回归） | 500 行流 → 快照尾行一致 → DOM 仍 400 行（上限） | [400,"L 400"] | ✅ |
| TC-44 | 快照分叉时重建 | 末行不一致 → DOM 重建为快照 [snap-a, snap-b] | ["snap-a","snap-b"] | ✅ |
| TC-45 | 空日志快照 | DOM 清空且计数刷新 L 00 | [0,"L 00"] | ✅ |
| TC-46 | 抽屉不吞窗控（P3 回归） | 抽屉开着时右上窗控命中 data-act | ["4","5","close"] | ✅ |
| TC-47 | 真指针点击最小化（caption 死区回归） | elementFromPoint 命中 minimize 且 windowAction 被调用 | ["minimize",["windowAction:minimize"]] | ✅ |
| TC-48 | 批先到+快照同尾不重复（B2 回归） | DOM=3 行不重放 | 3 | ✅ |
| TC-41 | shell API 整体缺失 | 页面不崩；渲染 error 态 + failure 文案 | ["error","桌面端启动失败"] | ✅ |
| TC-42 | reduced-motion 冻结 | dots/brand-sheen/ticker 脉冲 animation-name=none | {"dots":"none","brand":"none","dot":"none"} | ✅ |

合计 48 条：48 通过 / 0 失败