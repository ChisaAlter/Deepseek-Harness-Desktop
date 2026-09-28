# Agent Note: 桌面回归契约保留身份与交互

Status: implemented

[English](2026-09-28-desktop-regression-contracts.md) | 中文

## Problem

桌面集成保留退场内容并增加角色化控件，但旧测试要求立即移除和圆角字面量。弹窗清理还覆盖调用方明确选择的返回焦点，并选中已禁用入口。模型插件改名及 const enum 编译擦除，使回放和日志夹具偏离运行时契约。

## Decision

桌面分歧通过共享 token 保留已有几何与角色色。弹窗清理尊重调用方已选择的有效焦点；原入口不可用时返回父层自动焦点控件。退场测试先验证立即退出无障碍树，再验证最终卸载。

测试提供声明的服务，通过公开 logger exporter 观察日志，不读取已擦除的枚举。属性测试保留非法工具调用拒绝覆盖。回放 overlay 使用现行 API-key 提供方。keyless replay 显式设置 `DSH_SNAPSHOT_HEADERS=refresh` 时只更新请求头副本，并验证录制 Session 字节不变；普通回放仍只读。

客户端目录先规范化换行，再把源码声明转义为 TypeScript 字符串。LF/CRLF 回归比较完整生成物，几何测试解析 token 后仍断言具体数值。

## Alternatives considered

关闭退场或接受全部快照差异会隐藏产品回归；强制像素字面量会拒绝等价 token；从属性生成器剔除非法输入会丢失负向覆盖；为刷新工具说明而重写录制 Session 代际会破坏历史输入证据。

## Consequences

修复保留交互与失败契约，让测试跟随真实生命周期阶段。桌面角色默认值仍属集成选择，不重定义上游默认色板。组件检查不替代真实浏览器或安装包验收。
