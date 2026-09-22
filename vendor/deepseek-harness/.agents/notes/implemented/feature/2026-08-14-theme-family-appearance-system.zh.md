# Agent Note: 主题家族外观系统

Status: implemented

[English](2026-08-14-theme-family-appearance-system.md) | 中文

## 问题

Web UI 只提供浅色／深色／跟随系统。这三个方块放在「通用」里，持久化文档只存一个 `ui-theme.preference`，其他色板只能靠进程内 `register()` id，刷新即消失。桌面壳已经带了六套启动色板，但它们只涂 Electron 铬架，进不去 `--dsw-alias-*`。用户无法在重启后保住非默认外观，无法编写自定义家族，也无法在 token 表之外单独调节浮层实心程度或字体。

## 决策

**保留 ThemeRuntime 与别名层约定。** 呈现器仍从 `ThemeSnapshot.active` 涂 `body`。新工作加入 `ThemeFamily` 文档（一张卡、浅／深两半种子色）、写出 `--dsw-alias-*` 的推导步骤，以及可持久化的两半 id。DeepSeek 家族的推导 token 为空，因此只存了 `preference` 的配置文件仍走现有 CSS 表。推导出的家族把画布留在种子背景色上，并把强调色映射到表里原本钉死 DeepSeek 蓝的彩色铬架 token（`--dsw-alias-state-business-primary`、`--dsw-alias-button-info-fill`、`--dsw-specific-bubble`、侧栏选中项），这样自定义颜色会出现在对话里，而不是只出现在外观页滑杆上。

**色制与家族拆开。** `preference` 仍决定现在用哪一半（`light`／`dark`／`system`）。`activeLightThemeId` 与 `activeDarkThemeId` 决定该半由哪个家族来画。点浅色球只写浅色 id，点深色球只写深色 id。`setTheme` 继续写色制（或选中一个进程内扩展 id）。

**自定义家族写进同一 Host 分节。** `customThemes` 是 `ui-theme` 上的 `ThemeFamily` 数组。导入会做 schema 校验，并在 id 撞车时改名。删除某半正在使用的家族时回退到 DeepSeek。第三方 `register()` id 仍只存在于进程内。

**外观独立成设置页。** `ui-theme` 注册 `settings.section`，`id: appearance`，`order: 5`。「通用」不再放三个方块，只留一处入口。该页拥有色制三卡、双色球主题库、创建／复制／编辑／导入／导出、可选背景图（设好后出现毛玻璃和像素化滑杆）、玻璃透明度和字体。字体「高级」折叠是浏览器实例状态，存在 `localStorage`（`dsh:typography-advanced`）。背景图 data URL 不进启动脚本，以免撑大 index；插件树起来后由 ThemeRuntime 铺图层，并把主铬架填充混成半透明，好让底图透出来。

**在 React 之前引导当前半。** Host `tapIndex` 嵌入色制、已经推导好的两半 token 字典、字号和玻璃透明度。内联脚本只解析 `system`，并把当前半写到 `body` 上，避免非 DeepSeek 家族先闪默认色板。

**玻璃与字体是附加项，不是每主题文档。** `--dsw-alias-glass-opacity` 只混合菜单、对话框、设置面板和输入条的填充。会话列保持实底。字体栈写在 `documentElement`（`--dsw-font-family`、`--ds-font-family-code`，以及输入框／终端附加项），不塞进家族文档。

**桌面铬架跟随当前半。** Electron 启动页的 `--bg`／`--fg`／`--accent` 来自同一套家族种子（Host `settings.yaml`，`system` 经 `nativeTheme` 解析）。Harness 文档加载后，仍由现有 DOM 采样回写窗口底色。

## 曾考虑的替代方案

**搬一套平行的 `--background`／`--primary` 表。** 否决：现网每张表和呈现器都只认 `--dsw-alias-*`。推导写我们的名字。

**用新 store 换掉 ThemeRuntime。** 否决：register／overrideTokens／`theme/change` 已经存在；缺的是家族与两半持久化。

**只在桌面用 `config.json` 的 `theme` 做一层覆盖。** 否决：那套色板进不去 Web UI。产品面是 vendored 的外观页。

**把字体「高级」开关写入 `settings.yaml`。** 否决：它是折叠状态，不是用户偏好，沿用现有的 Host 持久化与浏览器实例状态划分。

## 后果

只含 `preference` 的旧 `settings.yaml` 仍是 DeepSeek 浅／深表。选中青瓷深色半后刷新仍在。`system` 加操作系统切换会走对应的半。自定义家族可持久化；VS Code 主题转换仍暂缓。浮层实心程度默认 80%。桌面启动铬架与 Web UI 共用同一套家族词汇。
