# Agent Note：工作区文件悬浮预览

Status: implemented

[English](2026-09-07-floating-workspace-file-preview.md) | 中文

## Problem

Files 原本能在右侧 surface 预览、编辑文本并展示图片，Browser 则能进入原生置顶画中画窗口。用户在对话过程中查看图片、文档或源码时，一旦切换 surface 就无法让该文件继续留在视野中。把所有文件都转进 Browser PiP 也不合适：T3 Code 在 `4e969f373` 的实现会以 12 fps 把实时浏览器 guest 截成 JPEG；这适合交互网页，却会损失静态图片与文本的清晰度，并为文档制造无意义的持续开销。

## Decision

**Files 增加直接的原生悬浮查看器。** 只有桌面 preload 暴露 `previewOpenFileWindow` 时，预览工具栏才显示 `IconRightUpOutline16` 动作。调用只携带 `cwd` 和 `relativePath`；main 使用既有 workspace authority 与带 token 前缀的 loopback server 校验，再打开或复用唯一一个只读、置顶 `BrowserWindow`。继续打开文件会原位替换 occupant，并使用 `showInactive()` 保持对话焦点。

窗口保留系统标题栏，内容面使用官方 Web UI canvas token。图片与 SVG 用 `img`；视频和音频用原生媒体控件；PDF 用 Chromium 查看器；HTML 在不含 `allow-same-origin` 与顶层导航权限的 sandbox frame 中运行；文本复用既有 1 MiB `readFile` 合同，在只读 `pre` 中展示。未知二进制文件显示明确的不支持状态。loopback server 新增媒体 MIME，并接受单段 HTTP byte range，保证 Chromium 能拖动媒体进度。悬浮窗不会获得 Node、编辑缓冲区或 Files 保存协调器。

file-preview preload 刻意窄于 `window.shell`：它只能读取当前不可变预览快照并订阅主题变化。状态 IPC 只接受悬浮窗自身的 `webContents`；仍只有 harness 能调用打开或替换文件。

## Alternatives considered

**所有文件复用 Browser PiP。** 否决：持续 JPEG 捕获会降低图片与文本清晰度，没有原生媒体 seek，并重复传输 loopback 文件服务本可直接交付的像素。

**每个文件打开一个悬浮窗。** 否决：这会产生不受限的置顶窗口，并削弱 Files 工作环模型。单个可替换查看器与现有 PiP 的唯一所有权规则一致。

**把可编辑 FilePreview React 树迁入新窗口。** 否决：跨 renderer 共享脏缓冲区与保存协调会引入冲突和生命周期风险。悬浮查看器有意只读，并反映磁盘版本。

## Consequences

用户可以让工作区图片、媒体、PDF、HTML 或文本文件置于桌面上方，同时继续对话。未保存编辑仍由 Files tab 独占，因此保存前悬浮窗可能显示上一次磁盘版本。关闭窗口不会关闭 Files tab；重启或退出时关闭全部 preview 资源，也会先关悬浮查看器，再停止 workspace token server。

## Testing

桌面测试覆盖类型分类、单窗复用、置顶与 sandbox 选项、仅自身 sender 可读的状态 IPC、二进制兜底、preload 暴露面、主题分类、shell 暴露、workspace MIME 与 byte-range 响应，以及 preview 关闭。ui-files client 测试点击 Floating preview 并钉死 `{ cwd, relativePath }` 载荷。真实 Electron 烟测打开 `assets/icon.png`，确认图片在深色 token 表下完成加载并截取窗口画面，再在同一窗口替换为可滚动的 `README.md` 文本视图。PDF、HTML、视频和音频路径由类型／MIME／range 测试覆盖，仍保留为发版手工用例。
