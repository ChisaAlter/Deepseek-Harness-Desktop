# Agent Note: 输入区文件入口按位置去重传输列表

Status: implemented

[English](2026-09-18-composer-file-intake-positional-dedup.md) | 中文

## Problem

向输入区粘贴一张图片会起稿出两张相同的附件；拖入文件同样如此。两个入口——输入区 keymap 的 `PASTE_COMMAND` 与 `ui-attachment` 的 drop 监听——都先从 `dataTransfer.items` 收集，再扫一遍 `dataTransfer.files` 找回没有 item 认领的条目（[文件夹拒收记录](2026-09-14-composer-folder-intake-rejection.zh.md) 加入的兜底），并用 `File` 对象身份给两份列表去重。真实的传输对象在每次访问时都生成新的 `File`：`items[i].getAsFile()` 与 `files[i]` 从不共享身份——连同一个 `getAsFile()` 调两次都不相等——因此身份集合永远匹配不上，真实粘贴或拖入的每个文件都进了入口两次。单测和 Playwright e2e 都没抓到，因为它们让 `items` 与 `files` 共享同一个 `File` 实例（夹具对象与 `new DataTransfer()` 共享身份，真实剪贴板传输不会）。

## Decision

按位置去重。`dataTransfer.files` 按序镜像 items 中的文件条目，因此兜底扫描为每个产出过 `File` 的 item 跳过开头一个条目（`productive` 计数），只收集剩余条目。文件夹占位仍计为 productive——它在 `files` 中的镜像保持仅拒收；而完全无产出的 `items` 列表（string 类型或 `getAsFile` 返回 `null`）仍会扫入全部 `files` 条目，未认领文件的恢复路径不变。两个入口现在跑同一段逻辑。

## Alternatives considered

**删掉 `files` 兜底扫描。** 它是找回 items 列表无法产出的文件的唯一途径；删掉后，不枚举条目的引擎会静默丢失拖入与粘贴——这正是当初加兜底要解决的场景。

**按内容签名去重（name + size + type）。** 两个真实不同的文件可能三者全同（同名且等大的截图），签名会把真实的第二个文件折叠掉——静默丢失比它要防的重复更糟。

**读字节去重。** 在同步的粘贴/拖入路径上比对文件内容会给高频手势加异步读取，而且仍然无法决定保留哪一个重复。

## Consequences

一次真实的粘贴或拖入只产生一个草稿附件；接受的批次保持 item 顺序。两个入口的 `classified`/`Set<File>` 簿记均已移除。`input-bar.client.spec.tsx` 与 `composer-attachments.client.spec.tsx` 中的回归用例按真实传输的身份语义建模（每次访问返回新 `File`），夹具再也无法掩盖不匹配。
