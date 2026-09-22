# Agent Note：显式保存经 coordinator flush，只确认自己的快照

Status: implemented

[English](2026-08-25-file-save-race-and-flush.md) | 中文

## 问题

`FilePreview.save()` 在 await 写盘之后才读取 `draftRef.current` 并把它标记为已保存。写盘期间敲入的字符会被当作已保存基线，而磁盘上的字节仍是 await 前的快照：缓冲区显示干净，下一次 `active` 重读用磁盘内容覆盖编辑器，静默丢掉这些字符。显式保存还绕过了 `FileSaveCoordinator`，防抖写与显式写可以在同一文件上交错落盘。

## 决定

`FileSaveCoordinator` 新增 `flush(contents)`：把调用方快照记为最新 revision、取消挂起的防抖、等完唯一的飞行中写入（与防抖路径共享 `inFlight` promise 槽位）后落盘。`FilePreview.save()` 改走 `flush(draftRef.current)`，由 coordinator 的 `onConfirmed(contents)` 发布已保存基线——`onConfirmed` 把 `text` 设为已写快照、保留最新草稿，写盘期间的字符保持 dirty，且在下一次重读后仍然存活。

## 备选方案

**只在 `save()` 内做快照修复**（await 前捕获 `contents`，成功后确认该快照）——能修数据丢失，但防抖/显式双写仍在：两个不同 revision 的 `writeFile` 并发时仍可能乱序落盘。coordinator 本来就拥有写序列化职责，把显式路径并入它可以用一套机制堵住两个洞。

## 后果

- 保存/Ctrl+S 期间打字不再把未写入的字符标成已保存；页签保持 dirty，随后的防抖写会把它们落盘。
- 显式写与防抖写通过同一个飞行槽位串行；flush 在等完飞行写入后还会取消它可能重排的防抖，flush 的 revision 恰好写一次。
- 磁盘漂移守卫（`error.changed`）不变：persist 仍先重读，磁盘同时偏离基线与草稿时拒绝一次。
