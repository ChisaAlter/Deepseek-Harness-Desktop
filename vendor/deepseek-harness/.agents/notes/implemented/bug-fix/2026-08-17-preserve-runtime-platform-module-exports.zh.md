# Agent Note: 保留运行时平台模块导出

Status: implemented

[English](2026-08-17-preserve-runtime-platform-module-exports.md) | 中文

## Problem

Web shell 会向运行时加载的插件发布共享平台模块。Vite 只保留静态 shell 自身引用的导出。因此插件即使加载成功，也可能得到某个有效字符串键导出的 `undefined`。Git 标题栏插件请求 `IconCloudUploadOutline16` 后在渲染时抛错，导致整个尾部 slot 未挂载。尽管插件已经激活，分支选择器和 Git 控件仍然消失。

## Decision

`getStaticModules()` 会先通过 `preserveModuleExports()` 复制每个共享模块命名空间，再交给运行时模块加载器。这个可观察的命名空间复制让 Vite 保留每个平台模块的全部公开成员，同时加载器仍然接收普通的类模块对象。

组装后的 Web 测试通过运行时模块系统导入 `@deepseek-ai/dsh-client-ui-primitives`，并验证 Cloud Upload、Commit 和 Pull Request 图标都是函数。标题栏测试还要求渲染 Switch branch 控件，并记录其无障碍输出。

## Alternatives considered

**只保留缺失的 Cloud Upload 图标。** 拒绝，因为未来任一运行时插件都可能访问另一个静态 shell 未使用的公开导出，并以另一种控件重现同样的问题。

**关闭 Web 构建的 tree shaking。** 拒绝，因为这会在整个 bundle 中保留无关代码，而不是只保留明确提供给运行时插件的模块命名空间。

**让每个插件直接静态导入 shell 依赖。** 拒绝，因为插件加载器有意在运行时解析共享模块；集中式静态注册表会重复这一机制，并降低插件独立加载的能力。

## Consequences

已发布的平台模块 chunk 会保留其公开导出，因此运行时加载的插件可以使用其声明的 UI primitive，不再依赖 shell 其他位置的偶然静态引用。当平台包导出未被使用的成员时，相应共享 chunk 可能变大；该成本只限于明确向插件提供的模块。

生产构建回归会在桌面 shell 收到产物前捕获缺失的运行时导出。它不会验证每个导出的行为；各包仍需负责自己的 API 测试。
