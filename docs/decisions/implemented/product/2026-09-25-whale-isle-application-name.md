# Decision: 对外应用名统一为 Whale Isle

Status: implemented

中文 | [English](2026-09-25-whale-isle-application-name.en.md)

## Problem

侧栏已经使用「鲸屿 / Whale Isle」，但窗口、安装器、启动器、托盘和 Web 仍显示 Deepseek-Harness-Desktop 或 DeepSeek Harness，用户会误以为它们是不同产品。直接更改 Electron 的 `productName` 又会改变默认 userData 路径和可执行文件名，影响已有安装及会话。

## Decision

对外主名称统一为 **Whale Isle**，中文「鲸屿」作为辅助名称；仅在品牌来源说明中保留 **DeepSeek Harness**。侧栏字标沿用已定稿的「鲸屿 / WHALE ISLE」顺序和字号；桌面窗口、启动器、安装器、快捷方式、托盘、Web/PWA 和手机伴侣界面采用英文主名称。

保留 `ai.deepseek.harness.gui`、`ai.deepseek.harness.launcher`、仓库名、npm 包名、协议及 `DSHD_*` 配置键等内部标识。桌面与独立启动器继续使用原来的 userData 路径，避免改名后丢失配置、会话或单实例锁。新版发行资产使用 Whale Isle 名称；更新与安装探测同时接受旧版资产、旧可执行文件及旧安装记录，以支持原地升级。

## Alternatives considered

仅改侧栏和窗口标题：安装器、系统列表及 Web 安装名称仍会出现旧名，无法形成统一产品身份。

同步改仓库、appId、数据目录和全部内部协议：会破坏现有安装、更新及配置位置，且这些标识不是用户看到的产品名称。

## Consequences

发布工作流、安装资产校验、启动器安装探测与打包测试必须跟随新资产名。旧版本仍可被识别并升级；已有用户数据继续留在原路径。第三方内容中提及 DeepSeek Harness 时指的是底层项目，不作产品名替换。
