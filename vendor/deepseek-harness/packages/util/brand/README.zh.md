---
description: "Branded<B> 名义类型原语，供拥有跨包边界 id 的包使用，并说明何时应添加品牌。"
kind: "package-library"
---

# @deepseek-ai/dsh-brand

[English](README.md) | 中文

## 概述

`dsh-brand` 借助其 `Branded<B>` 原语，让结构相同的字符串在类型层面不可互换：即使 `SessionId` 与 `ToolCallId` 在运行时都是普通 `string`，前者也无法传给期望后者的位置。由于品牌在编译期被擦除，比较、日志记录、JSON 序列化与协议格式（wire format）的行为都与普通字符串完全相同。它是纯类型包，没有运行时代码，也不依赖其他 harness 包，因此任何包都可以为自己拥有的 id 添加品牌，而无需导入不相关的能力包。拥有跨包 id 的包——`dsh-llm` 中的 `ToolCallId`、共享的 agent/会话 `SessionId`、`dsh-jobs` 中的 `JobId`——为该 id 添加品牌，并通过各 id 专用工厂构造。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

当包拥有的 id 跨越包边界、并可能与其他包的 id 混淆时，为其添加品牌；并非每个字符串都需要品牌。品牌化 id 是给 TypeScript 调用方的约定：它只会进入期望它的函数，来自其他包的 id 会在编译期被拒绝。

### 为 id 添加品牌

在所属包中声明品牌化类型及其构造工厂：

```ts
import type { Branded } from '@deepseek-ai/dsh-brand'

export type SessionId = Branded<'SessionId'>

/** Brand a string as a SessionId (a plain cast — zero runtime cost). */
export function SessionId(id: string): SessionId {
  return id as SessionId
}
```

工厂是一次普通类型断言，运行时成本为零。添加品牌后，该 id 在代码库中与普通字符串无异：它可以比较、记录日志、序列化为 JSON，并无需任何特殊处理即可跨越协议传输。

### 何时添加品牌

为跨包边界且可能被混淆的 id 添加品牌——`dsh-llm` 中的 `ToolCallId`、`dsh-session` 中共享的 agent/会话 `SessionId`、`dsh-jobs` 中的 `JobId`、`dsh-lsp` 中的 `LspProviderId`。不要为每个字符串都添加品牌：代价是每个构造点一个工厂、每个消费方一次类型导入，因此从不离开所属包的 id 不值得这样做。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

该原语是一个交叉类型：`string & { readonly [BRAND]: B }`，其中 `BRAND` 是模块私有的 `unique symbol`。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | `Branded<B>` 类型与私有 `BRAND` 符号——即整个包 |
| [`src/invariant.ts`](src/invariant.ts) | 不变式伴生插件（无运行时不变式；擦除由编译器保证） |

### 擦除如何工作

该符号在运行时绝不存在：类型在编译期被擦除，因此品牌化值就是普通字符串，没有标签、没有原型、没有运行时检查。构造发生在所属包工厂内部的一次类型断言中，因此品牌只会在所属包声明它的地方被创建。

### 为何保持无依赖

把 `Branded` 放在独立包中，意味着 `dsh-jobs` 可以为 `JobId` 添加品牌，而无需仅为使用该原语导入不相关的能力包；品牌词汇也因此只有唯一归属。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当你需要本原语所品牌化的 id 或围绕它的类型约定时，阅读以下页面。

- [核心子系统](../../../docs/subsystems/core.zh.md)——共享 `SessionId` 品牌与类型规则的记录位置。
- [LSP 子系统](../../../docs/subsystems/lsp.zh.md)——构建在本原语之上的品牌化提供方 id `LspProviderId`。
- [jobs 包](../../jobs/jobs/README.zh.md)——由 jobs 能力拥有的 `JobId` 品牌。

-----

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
