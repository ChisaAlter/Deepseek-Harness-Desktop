# Agent Note: 阶段构建输入归属

Status: implemented

[English](2026-09-30-stage-build-input-ownership.md) | 中文

## 问题

阶段凭据遗漏 `scripts/` 的构建 helper 和 `vendor/` 的 Cordis 工作区，尽管 client bundle 导入这些 helper、host 编译引用这些工作区。修改它们但不改变 Git HEAD 时，源码启动会继续使用陈旧产物。native 凭据还选取 `entry/bin`，而 native builder 实际写入当前主机的平台包。

## 决策

阶段布局覆盖根构建清单、构建 helper、vendored 源码与 native 声明。产物归属使用精确根：vendor 和 native entry 的 `lib/` 文件属于 host 编译，native 阶段记录当前主机平台的 `bin/`。`src/` 下名为 `lib` 的源码目录仍算输入。每次扫描先区分生成产物和源码，再计算凭据。

## 考虑过的替代方案

**强制每次构建。** 这能刷新遗漏的输入，却舍弃已验证阶段的复用。完整的输入与产物归属在保留复用的同时使修改失效。

**将所有名为 lib 的目录视为产物。** 这能避免产物反馈，却排除真实源码 helper。精确的包产物根保留这些输入。

## 后果

扩大路径集合后，已有凭据在集合不一致时刷新。共享构建 helper 的修改可能重建多个阶段，因为输入集合采用保守范围。native 凭据现在跟随 builder 的实际主机产物目录。凭据格式与编译命令保持不变。

## 测试

`scripts/build-stage-credentials.client.spec.ts` 覆盖无变化复用、helper 和 vendored 源码修改、vendor 产物篡改且不反馈至输入、平台 native 声明，以及凭据缺失或畸形。
