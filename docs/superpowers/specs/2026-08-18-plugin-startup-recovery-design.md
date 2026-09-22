# 第三方插件启动恢复

桌面端在首次安装、升级、或 `dsh plugin add` 之后，用户 profile 里的第三方 bundle 会把整棵 plugin tree 拖死。Harness 对组合失败 fail-loud 是对的。本设计让官方 Web UI 一定能起来，并且默认不改用户的 `package.json` / `cordis.patch.yml` 去猜该禁哪个插件。

视觉语言仍是官方 `dsh web`。启动页只改仪器画布上的状态文案和现有按钮语义，不增加市场、卸载或第二套皮肤。见 [design-language.md](../../design-language.md)。

热禁用 UI 仍归 [marketplace parity](2026-08-18-marketplace-parity-design.md) 第 3 轮。本设计不写 `disabled: true`，不增加 JSON 账本。

## 决定

1. **恢复启动不改用户 profile。** 组合失败后用官方模板 bundle 再起一次，跳过 profile / home 用户 patch。磁盘上的依赖和 bundle 列表保持原样，除非是下面第 3 条的悬挂名修理。
2. **同一时刻只有一个 Loader 使用这份 `$DSH_HOME`。** 禁止换端口、同 home 双进程探测。
3. **每次启动都 heal 悬挂 bundle 名。** `dsh.profile.bundles` 里解析不到、又不是官方模板成员的名字从列表拿掉，`dependencies` 保留。这是数据修理，不是归因。
4. **禁止按错误文案自动 `disabled: true`。** Cordis 会把失败包成 `include` / `modules` / 官方 `tools`；`cannot get property "tools" without inject` 里的 `tools` 是服务名。group 条目忽略 `disabled`。
5. **就绪信号是 `dsh web:` 这一行，不是 HTTP 探活。** `web-runtime` 在 Loader 整棵树 `await()` 成功之后才打印该行。只认 HTTP 会在用户插件 apply 之前把状态标成 `ready`，随后 exit 1 被当成 runtime 崩溃并自动重启。
6. **粘性跳过记在桌面 `config.json`，不记在 profile。** 应用版本变化时清掉，下次先走完整组合。

## 非目标

- 不改 Cordis，不把用户 include 做成 fail-soft。
- 不把就绪后的普通 runtime 崩溃归罪到某个插件。现有 `harnessAutoRestart` 只处理那些崩溃。
- 不在启动时跑 `dsh.compatibility` 当作恢复支柱。没有该声明的包会放行；缺 `inject` 不是 host feature。
- 不静态扫描社区插件。
- 启动页不做插件市场，不提供卸载。
- 不预装 `dshmarket`。
- 不做 innermost-id 隔离循环，不做 N 次盲禁。

## 官方组合

`PROFILE_TEMPLATES.web` 是 `@deepseek-ai/dsh-base` 然后 `@deepseek-ai/dsh-web-app`。

恢复启动只解析这两层。桌面安装插件不是 bundle，活在托管 patch 里：完整启动走 profile 的 `cordis.patch.yml`；恢复启动跳过该文件，所以必须另用 launcher `--patch` 把同一段 insert 叠回去。id 仍是 `dshd-desktop-plugin-install`。

`$DSH_HOME/cordis.patch.yml`（home 层，盖过 profile 层）在恢复启动里也不读。

## Vendor：`--skip-user-plugins`

这是 launcher 旗标，和 `--patch` 同类，必须在 app 的 `--host` / `--port` 之前解析。加在根命令和 `web` 别名上。

```text
dsh web --skip-user-plugins --patch <desktop-install.yml> --host 127.0.0.1 --port 3080
```

语义：

| 层 | 完整启动 | `--skip-user-plugins` |
|---|---|---|
| 模板 bundle | 清单里的 `dsh.profile.bundles` | 只解析 `PROFILE_TEMPLATES[name]`，不写回清单 |
| 清单里多出来的 bundle | 解析，缺包则 fail-loud | 忽略 |
| profile `cordis.patch.yml` | 应用 | 跳过 |
| home `cordis.patch.yml` | 应用 | 跳过 |
| `--patch` 与 telemetry 开关 | 应用 | 应用 |
| `watchUserPatches`（profile 与 home） | 挂上 | 不挂；否则 HMR 会把跳过的用户层热加载回来 |

`loadProfile` 增加 `bundles: 'manifest' | 'template'`（默认 `manifest`）。`template` 用 `PROFILE_TEMPLATES[name]`，没有模板时用 `DEFAULT_PROFILE_BUNDLES`。不调用 `writeProfileManifest`。

与 `--dump-default-config` 互斥：后者是「清单上的 bundle 层、无用户层、无 `--patch`」；恢复组合用 `--skip-user-plugins --dump-config` 查看。

同仓库的 vendor 切片带一条 implemented Agent Note，放在 `vendor/deepseek-harness/.agents/notes/implemented/`。

## 桌面：分类与就绪

plugin-tree 失败（即使 `failure.phase === 'runtime'`）包括 stderr / 退出信息中的：

- `plugin tree failed to load`
- `cannot resolve profile bundle`
- `failed to apply loader entry`
- `entries did not activate`
- `client-modules:` 组合失败（含 `ClientPackageCompositionError`）

命中则 **取消** `beginRuntimeRecovery`。不要再叠一套隔离重试预算。

`DshManager.waitUntilReady` 在看到 `dsh web: http://`（或 `https://`）之前不得把状态标为 `ready`。现有 HTTP 探活可以留作该行出现之后的确认，不能单独当作就绪。`attachOutput` 里任何 `127.0.0.1` URL 都算就绪的逻辑废止。

Node 树已就绪、客户端 `pluginBoot.failed` 时，现有路径会停掉 child。若当时不是 skip 模式，按 plugin-tree 失败同样进入恢复启动。若已经是 skip 模式，当作官方故障，停在启动页。

## 桌面：启动状态机

`pluginRecovery` 只由主进程写入 `config.json`，不进 `normalizeRendererConfigPatch`。

```ts
pluginRecovery: {
  skipUserPlugins: boolean
  reason: string
  at: string
  appVersion: string
}
```

`performStart` 每次都先 `stripDroppedPlugins`、heal 悬挂名、`ensureDesktopInstallPlugin`（并写出 `profiles/web/desktop-plugins/cordis.patch.yml` overlay）。

然后：

```text
若 skipUserPlugins 且 appVersion 仍是写入时的版本
    → 直接恢复启动（带 --skip-user-plugins 和 desktop-install overlay）
否则
    → 清掉过期 skip（版本变了）
    → 完整启动
         ├─ 成功 → 清 pluginRecovery
         ├─ plugin-tree 失败 → 停 child → 写 skip → 同 home 再做一次恢复启动
         │     恢复成功 → 进入 Web UI，skip 保持
         │     恢复失败 → 启动页报错，不再自动折腾
         └─ 其它失败 → 现有 startup 错误路径（不写 skip）
```

同一时刻只存在一个 Harness child。恢复启动前必须 `stop` 完整启动留下的进程。

`buildLaunch` 的 source / 本机 `dsh` / npx 三条路径都把 `--skip-user-plugins` 和可选 `--patch` 放在 launcher 段（`web` 之后、`--host` / `--port` 之前）。app 旗标位置不变。

升级桌面：`app.getVersion()` 与记录不同则先完整启动，即使上次 skip。

恢复启动失败时 `skipUserPlugins` 保持 true，避免下次打开先再付一次注定失败的完整启动。启动页「重试」清 skip。

## 悬挂名 heal

官方模板名永不因「解析不到」被删；那是产品损坏。

用户 bundle 名：目录或 `resolveBundleDir` 失败则从 `dsh.profile.bundles` 去掉，依赖条目不动。用户可随后 `dsh plugin install` 或在市场卸载。

`reconcileBundleLayers` 在「已经不是 dependency」之后不会删只存在于 bundles 的名字。heal 补的就是这个洞。不要在每次启动跑完整 reconcile：那会把新获得 `dsh.bundle` 的 plain 依赖激活进列表。

`stripDroppedPlugins` 继续按 `DROPPED` 从依赖和 bundles 两边删。它调用的 `stripManagedPatch` 仍剥 `# --- dshd-gui-plugin-toggles ---`。本设计不往那一块写东西。第 3 轮热禁用必须换一块 **不会被** `stripDroppedPlugins` 剥掉的托管块，或停止无条件剥离。

## 安装与卸载

前提：完整启动曾经成功过（`skipUserPlugins === false` 且当前 child 是完整组合）。

1. 停 live child。
2. `dsh plugin --profile web add`。
3. 完整启动。
4. plugin-tree 失败 → `dsh plugin --profile web remove` 刚加的那个包 → 再完整启动。
5. 不要换端口探测，不要快照三份文件。撤销就是 `remove`。

`install_dsh_plugin` 与设置里的安装走同一条。

已经在 skip 模式时：

- **安装**：add 之后不要用「失败就 remove 新包」。完整组合事先就起不来，会误删新包。add 后保持 skip，启动页/横幅提示用「重试完整启动」检验。
- **卸载**：`dsh plugin remove` 后 **清 skip 并完整启动**。卸对了就恢复；还失败再写回 skip。

启动页没有卸载。市场 Tab 的已装列表读磁盘 profile，恢复模式下仍可卸载。

## 界面

启动页仍是仪器画布、一个主按钮「重试」。

| 状态 | 文案方向 | 「重试」 |
|---|---|---|
| 完整启动中 | 现有「正在启动运行时」 | 隐藏 |
| 自动转入恢复 | 「正在以官方组合启动」；说明第三方插件导致上次失败、已暂时跳过 | 隐藏 |
| 恢复已成功（转 Web UI 前可一闪） | 不另做一页 | — |
| 恢复也失败 | 「启动失败」+ 日志 | 清 skip，再走完整启动 |
| 用户在 skip 粘性下打开应用 | 直接恢复启动文案 | 隐藏 |

主按钮不叫「安全模式」，不增加「卸载肇事插件」。

Web UI 起来之后，设置 → 插件 → 市场 Tab 顶上用 `ui-primitives` 做一条告示（中文产品文案）：第三方插件已跳过；主按钮「重试完整启动」经 IPC 清 skip 并 `restart`。不要新开 `settings.plugins.tab` id。插件列表 Tab 仍是 Loader 只读投影，skip 模式下只看得到官方行，这是预期。

`boot.js` 的错误日志过滤要能留下 `plugin tree failed to load`、`cannot get property`、`cannot resolve profile bundle`，不能只靠现有 `ERR_*` 正则。

## 分轮

每一轮单独实现，可以单独交付。

1. Vendor `--skip-user-plugins` 与 `loadProfile` 的 `bundles: 'template'`，含 dump 互斥、watcher 关闭、Agent Note 与 CLI/app-boot 测试。
2. 桌面 heal、就绪改用 `dsh web:`、plugin-tree 取消自动重启、恢复重拉、`pluginRecovery` 粘性、启动页文案、市场 Tab 告示、安装/卸载规则。

第 1 轮没有桌面也能用 CLI 验证。第 2 轮依赖第 1 轮的旗标。本仓库 vendor 与桌面可以同一 PR，测试仍按两轮列。

## 测试

Vendor：

- `--skip-user-plugins` 只解析模板 bundle；清单里的坏名字不导致 `cannot resolve profile bundle`。
- 跳过 profile 与 home patch；`--patch` 仍应用。
- 恢复组合不挂 `watchUserPatches`。
- 与 `--dump-default-config` 互斥；`--skip-user-plugins --dump-config` 打出的树没有用户 bundle 行。

桌面：

- HTTP 已通、随后 `plugin tree failed to load` exit 1：状态不得变 `ready`，不得调用 `beginRuntimeRecovery`。
- 悬挂的非模板 bundle 名在 `performStart` 后从清单消失，依赖还在。
- 官方模板名解析失败：不 heal，启动失败。
- 完整启动 plugin-tree 失败后，第二次 spawn 带 `--skip-user-plugins` 和 desktop-install overlay；用户 `package.json` 的 bundles 除 heal 外不变。
- 恢复启动仍失败：不第三次自动 spawn。
- `appVersion` 变化：即使 skip 为真也先完整启动。
- 完整组合下安装失败：remove 的是刚加的包，然后再完整启动成功。
- skip 模式下安装：不 remove 新包。
- skip 模式下卸载：清 skip 并完整启动。
- `stripDroppedPlugins` 仍剥 toggles 块；desktop-install 块保留。

## 否决

**账本 JSON + 按 innermost id 禁用。** 三个写入者已经在抢 profile；分类器会禁官方行。

**同 home 换端口探测。** 两个 Loader 抢 sessions、heal junction、patch HMR；Windows 上还会锁 `node_modules`。

**只禁用户 bundle、仍应用用户 patch。** 坏 insert 和 home 层会留下。

**临时 `$DSH_HOME`。** 会话和设置不在用户目录；市场卸载会打到空 profile。

**启动页卸载。** `shell:uninstall-plugin` 不是 BOOT 角色；设计语言只给一个重试键。
