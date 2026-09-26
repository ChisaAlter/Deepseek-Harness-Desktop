# Decision: 桌面 Office 运行时装配（desktop office runtime）

Status: implemented

中文 | [English](2026-09-25-desktop-office-runtime.en.md)

## Problem

上游 0.1.7-rc.2 的 Office 能力由四件合成：`dsh-tool-workspace-dependencies`（锁定 Python/Node/pnpm payload 的原子安装）、`dsh-skill-office`（DOCX/PPTX/XLSX 技能 + `check_office.py` 资产）、`libreoffice-kit@0.1.1` + `win32-x64` 原生引擎（DOC/PPT/XLS 转换与 CLI 出图）、`ui-sidebar-documentpreview`（Office→PDF 与 Spreadsheet 呈现）。官方 `apps/desktop-host` 在启动时 supply 绝对 `source/assetRoot/node/cli`，并把 `primary-runtime`/`office-skills` 打进资源目录。鲸屿不走官方 Desktop Host——自己组 Node Web profile——所以 vendored 包在位不等于能力激活：没有 overlay 行这两件不挂载，没有 payload 没有 Node/Python，没有 desktop-file 让路 Office 文件会被通用 FilePreview 当成二进制吞掉。

## Decision

四条桌面自有接缝，全部复用既有 overlay 体系：

1. **`src/main/office-runtime.js`**：定位 bundled payload（dev=`build/office-runtime`，packaged=`resources/runtime`），校验 `runtime.json`（platform/arch/payloadDigest 全匹配）、独立 `node.exe`、`office-skills`（`check_office.py` + 三个 SKILL.md），并以 `dsh-skill-office` 为解析锚走真实 Node resolution 拿 `libreoffice-kit/lib/cli.js`——win32-x64 强校验原生引擎包（version/status/platform/可执行文件），不静默 WASM。产出 `desktop-plugins/office/desktop-office.patch.yml`（原子写），含 `workspace-dependencies`（source + `dsh-home/dsh-runtimes/dsh-primary-runtime` 作 root，插件自持 staging→validate→atomic install）与 `skill-office`（assetRoot/node/cli）两行 insert。`DSH_PRIMARY_RUNTIME` 覆盖整目录、空串显式退出（沿用上游载体语义）；`spawnEnv` 额外向每个 `dsh web` 子进程声明 `DSH_BUNDLED_PRIMARY_RUNTIME`。

2. **overlay 每次启动都挂**（full + skip-user-plugins）：Office 是桌面内置，disable 名单不适用；缺 payload/缺闭包在 packaged 下判运行时损坏 fail start，dev 下只警告保可启动。

3. **打包闭包**：`build/office-runtime → resources/runtime` 走 extraResources；`prepare:office-runtime` 驱动上游锁定 `prepare.ts`（SHA-256 钉归档）产出 payload；`assertOfficeRuntime`（win32 目标）钉死 payload + `dsh-office-to-pdf`/`dsh-skill-office`/`workspace-dependencies`/`libreoffice-kit`/`libreoffice-kit-win32-x64` 全闭包与引擎清单一致性，缺失即 fail build。skip-compose 契约两轮都断言两行各恰好一次。

4. **预览路由**：`ui-files` 的 `desktop-file`（extension 优先档）对 `doc/docx/ppt/pptx/xls/xlsx` 拒绝认领，落回 `text` fallback 由 documentpreview 的 Office→PDF/Spreadsheet 渲染；`ui-surfaces` 的 `openFile`/`openInSurfaces` 同样把二进制 Office 移交 `sidebarRight.openResourceIn`（自动展开右栏、互斥关 surfaces）。csv/tsv 有意留在可编辑文本视图（desktop 增强，上游 binaryExtensions 本就不含它们）。

## Alternatives considered

- **直接靠 sdk-app patch 的 env 门行**：那两行在 `sdk-app` patch 而非 web profile，且无 `cli`/`root` 显式配置——dev/打包两套根路径都无法解析对，不采用。
- **`DSH_PRIMARY_RUNTIME` 永远注入 shell env**：会破坏空串退出语义（继承的 env 已透传用户覆盖），只在未设时声明 `DSH_BUNDLED_PRIMARY_RUNTIME`。
- **Office overlay 挂进 `cordis.patch.yml`**：违反用户层所有權；overlay 层已是全部内置行的既有通路。
- **按计划字面新增 ui-files「Office 内容槽位」API**：既有资源注册表已是该槽位——`patterns`/`canOpen` 决议 + `openResourceIn(sessionId, address)` 以 props-only 传入发起 Session 与规范化地址，documentpreview 的 Office/Spreadsheet 呈现正是经它注入；新增平行槽 API 只复制既有协议，故沿用 `canOpen` 拒绝 + `text` fallback，不新增跨 feature 接口。
- **csv/tsv 也走 Spreadsheet 只读**：会失去 desktop-file 的可编辑文本能力，矩阵只钉 XLSX→Spreadsheet，保留现状并记录。

## Consequences

- 首调 `load_workspace_dependencies` 把 payload 原子安装到 `dsh-home/dsh-runtimes/dsh-primary-runtime`，失败留旧树；会话/Profile 不受影响。
- skill 三条（office-docx/pptx/xlsx）在 web profile 可见，`check_office.py` 与 standalone Node 全用 payload 内路径，不触 PATH。
- Kit 0.1.1 + win32-x64 native 的解析与版本一致性在 dev ensure、打包 assert、skip-compose 契约三层都验过；陈旧 0.0.1 运行时不可被接受。
- 非 win32 目标暂不出 Office payload（assert 门控跳过；已知限制记在 feature 卡）。
- 测试面：`office-runtime.test.js` 13 例（候选/清单/kit 引擎/overlay 稳定性/打包路径）、harness-controller 3 例（阻断/双路挂载/显式退出）、vendored `ui-files`/`ui-surfaces` spec 各 1-2 例；fork markers 登记三条。
