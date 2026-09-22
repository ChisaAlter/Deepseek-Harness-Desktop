# 透明主题（transparent-theme）QA — 2026-08-27

分支 `cursor/transparent-theme-2ed0`（PR #59）。本页是 **Linux 云端源码级** 结果，不是发版证据：
验收表（§9 TC-APP-012/013/014）的 Pass 栏仍留空，待 Windows CI artifact + 已装 exe 补测。

## 环境

- Linux 6.12（云端 VM，X 显示 `:1`，非无头 xvfb），Node v22.22.2，Electron 43.4.0（`node_modules/electron/dist/electron`）
- vendor harness 按 `npm run setup:harness` 构建（226 client artifacts）
- 隔离 user-data（`/tmp/dshd-transparent-live-*`），未触碰 `~/.dsh`
- 驱动脚本：[transparent-theme-live.mjs](transparent-theme-live.mjs)（CDP 驱动真实主窗口）；机器可读结果：[live-report.json](live-report.json)
- 壁纸用 512×512 随机噪点 PNG（可读性最坏情形）

## 结论

| 用例 | 结果 | 关键证据 |
| --- | --- | --- |
| TC-APP-012 透明主题 | **PASS（源码级）** | 开启后 `data-dsh-transparent` 置上、`--dsw-alias-glass-opacity: 0%`、sidebar fill `color-mix(... 0%, transparent)`、`#dsh-wallpaper::after` 压暗 mask 变 `rgba(0,0,0,0)`、玻璃滑杆禁用、终端 pane 保持实心 `#fff`；关闭后立即回 `80%`、mask 回 `rgba(0,0,0,0.24)`、滑杆恢复可用 |
| TC-APP-013 无壁纸惰性 | **PASS（源码级）** | 无壁纸开启开关：flag 记住但 `data-dsh-transparent` 不置、glass 仍 `80%` 且滑杆可用、拖到 60 立即生效 `60%`；提示「透明主题需要先设置背景图才会生效」 |
| TC-APP-014 可读性 | **PASS（源码级）** | 两条生效路径（开关先开→后设壁纸；壁纸已设→再开开关）都把毛玻璃 0 自动提到 **20**（一次性 nudge）；手动拉回 0 不被顶回，提示切换为低毛玻璃警告；噪点壁纸 + blur 20 下文字可读（见截图） |

驱动共 26 个断言全 PASS（见 live-report.json `steps`）。

## 自动化门

- vendor `pnpm run test:gui`：**411 文件 / 5396 用例全绿**（含新增 nudge / 低毛玻璃提示 spec）
- `tsc -b tsconfig.client.json`：53 个既有 `TypertClientRemote` 生成契约错误（main 上同样存在），ui-theme 零错误
- 仓库根 `npm run qa:source`：**全绿**（release UI walk 78 步 PASS/SKIP，无 FAIL）

## 截图

- `tc013_transparent_without_wallpaper_hint.png` — 无壁纸时开关开、界面不透明、玻璃滑杆可用
- `tc012_transparent_effective_settings.png` — 透明生效的设置面板（壁纸透过对话框）
- `tc014_low_blur_warning_hint.png` — 毛玻璃手动拉回 0：噪点全锐利，警告提示在 DOM 断言中确认
- `tc012_transparent_chrome_over_wallpaper.png` — 主界面：侧栏/标题栏/输入框全透，blur 20 下文字可读

## 备注

- 云端 renderer locale 跟浏览器为 en，驱动脚本按中英双语匹配控件与提示。
- 会话空态的「Add an API key」卡片在 0% 表面下同样全透 —— 属透明主题的预期行为，非缺陷。
- Windows 安装包（CI artifact + 已装 exe）验证仍待补：完成后由执行人回填验收表 Pass 栏。
