# Agent Note: 松散模块跳过 private 标记 manifest

Status: implemented

[English](2026-09-13-loose-module-private-manifest-skip.md) | 中文

## Problem

松散 Loader 配置项（file URL、相对或绝对模块路径）通过向上查找最近的 `package.json` 来解析所属包身份。该 manifest 可能属于无关的上层目录——例如形如 `{ "name": "dsh-profile-web", "private": true }`、没有 `version` 的 profile 或工作区标记文件。inventory 把任何具名但不完整的 manifest 视为格式错误的包元数据并抛错，DeepSeek 适配器再包装为 `REQUEST_EXTENSION`，导致在这类标记之下挂载松散模块的部署里每个官方请求都失败。

## Decision

松散模块解析把不完整的 manifest 视为标记而非包声明：当 manifest 没有 `name` 或声明了 `private` 时，不贡献包身份。带完整 name/version 的 `private` manifest 仍会报告身份。具名但缺少 `version` 的非 private manifest 继续使请求准备失败。裸包配置项遇到任何格式错误的 manifest 仍然失败，因为它们的 manifest 来自真实的包解析。

## Alternatives considered

**松散模块跳过所有不完整 manifest。** 具名的非 private manifest 是明确的包声明；静默省略会掩盖真正格式错误的包。`private` 标记是区分包声明与上层标记的可观察边界。

**限制向上查找 manifest 的范围。** 把 `nearestManifest` 限定在 Loader 树基址或配置项自身目录内也能避开无关标记，但会在观测到的故障之外改变解析语义，并可能漏掉合法的所属 manifest。

**只在挂载方部署中修复。** 在每个松散模块旁放置 `package.json` 只能修好那一个部署，其余松散挂载仍然只差一个上层标记文件就会让全部请求失败。

## Consequences

松散模块位于 private profile 或工作区标记之下时，请求不再失败。不带同目录 manifest 的松散模块挂载不贡献包身份，而不是报错或报出错误身份。格式错误的包声明仍然响亮失败。[inventory 测试](../../../../packages/llm/plugin-package-inventory-deepseek/tests/inventory.spec.ts) 覆盖 private 标记跳过与完整 private manifest 两种情形。
