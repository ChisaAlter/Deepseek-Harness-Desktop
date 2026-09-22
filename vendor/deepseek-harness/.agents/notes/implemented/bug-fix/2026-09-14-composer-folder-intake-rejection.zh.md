# Agent Note: 输入区文件入口拒绝文件夹占位项

Status: implemented

[English](2026-09-14-composer-folder-intake-rejection.md) | 中文

## Problem

拖入或粘贴的文件夹会以字节不可读的 `File` 占位对象进入 `dataTransfer.files`。输入区把它当作普通文件起稿并立刻开始后台上传，而这次上传注定失败：worker 传输报错，卡片只显示通用的「上传失败，点击重试」，重试永远不可能成功，草稿还卡住发送门槛——按 Enter 时甚至误报为仍在上传。已存下的 `uploads[id].message` 诊断信息从未到达用户。

## Decision

目录判定放在入口侧进行，因为 `DataTransferItem` 的 FileSystem entry 只在那里可用：`item.webkitGetAsEntry()?.isDirectory === true` 把占位项标记为拒收而非起稿。`ui-attachment` 的 drop 监听和输入区 keymap 的粘贴命令都通过 `onAddFiles`/`intakeFiles` 把已接受的 `files` 与 `rejected` 两个列表交给宿主；宿主用本地化 toast 通告被拒收的条目，只为真实文件起稿。drop 还会兜底扫描 `dataTransfer.files` 中未被任何 item 认领的条目，使无产出的 `items` 列表（string 类型或 `getAsFile` 返回 `null`）不会静默丢文件——兜底按位置去重，因为每次访问都会生成不同的 `File` 对象（[按位置去重](2026-09-18-composer-file-intake-positional-dedup.zh.md)）；没有 item 列表的入口（文件选择器）保持原有 `dataTransfer.files` 路径。选择器不可能产出文件夹，无 entry 的条目按文件处理。失败卡片的 `title` 提示现在携带记录下的上传 `message`，发送门槛对失败上传也报告失败而非「还在上传」。

## Alternatives considered

**在 `createDrafts`/`addFiles` 内部过滤。** 到那一层只剩 `File` 对象，目录占位项与真正的零字节文件无法区分——`FileSystemEntry` 答案只存在于 drop/paste 时刻的 `DataTransferItem` 上。

**读一个字节来探测不可读占位项。** 探测 `file.slice(0, 1)` 会在同步的 drop 路径上引入异步步骤，且仍无法区分空文件与目录，因此弃用，改用入口处的 in-band entry 判定。

**自动移除失败的上传。** 发送门槛仍要求用户显式重试或移除；静默丢弃失败草稿会丢失用户意图。修复只是把通告收窄，让失败状态不再伪装成进行中上传。

## Consequences

拖入或粘贴文件夹不再产生注定失败的草稿；用户会看到点名该文件夹的本地化拒收提示。失败上传在重试或移除前仍然阻塞发送，但卡片提示会显示传输层的真实信息，Enter 也如实报告失败。`FileCard` 新增可选 `reason` prop，`ComposerAttachmentsOwnerProps.onAddFiles` 新增可选 `rejected` 参数；对其他槽位宿主保持向后兼容。
