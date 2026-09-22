# Agent Note: Re-adopt imported sessions when registering a workspace

[English](2026-09-05-workspace-import-readoption.md) | 中文

Status: implemented

## Problem

已初始化的工作区登记不会在导入会话后再次执行首次启动分组。直接返回已有工作区而不刷新成员，会使后来导入的历史无法通过该登记访问；缓存的 cwd 解析失败也会在原目录恢复后继续隐藏历史。

## Decision

显式登记目录时，新工作区与已有工作区都刷新持久化 header。原 cwd 规范化后匹配的未归属会话通过现有实体写入路径按新到旧接纳，保留已有 ID、标题、成员顺序与归档状态。没有新历史时重复登记不产生持久化变更。

## Alternatives considered

**每次启动重新执行首次分组。** 这会复活用户主动删除的工作区登记；显式登记保留用户控制。

**改写导入的 cwd。** 无法可靠推断目录迁移，改写原始日志会改变历史执行上下文；只接受原目录匹配。

## Consequences

登记增加一次 header 扫描和路径校验，不触碰事件正文和来源 home。工作区测试覆盖后来导入、幂等、重启后的持久化成员以及启动后恢复的目录。
