# Agent Note: --skip-user-plugins 恢复组合

Status: implemented

[English](2026-08-18-skip-user-plugins-recovery-boot.md) | 中文

## Problem

profile 一旦多列一个组合包，或携带损坏的用户 `cordis.patch.yml`，整棵 plugin tree 都会响亮失败，连宿主仍需要启动的官方 Web UI 也被拖死。启动器已有用于 `--dump-default-config` 的 `loadProfile(..., { userLayer: false })`，但它仍会解析 `dsh.profile.bundles` 中的每一个名称，并且在真实启动时仍会读取 `$DSH_HOME/cordis.patch.yml`，因此无法从无法解析的额外组合包或有毒的 home 层中恢复。改写用户 manifest 去猜该禁用哪个插件，或在同一 `$DSH_HOME` 上再探测第二个 Loader，会改写或竞态用户唯一拥有的那份组合。

## Decision

`--skip-user-plugins` 是根命令与 `web` 别名上的启动器旗标，在 `--host` / `--port` 这类应用旗标之前解析。它通过 `loadProfile(..., { userLayer: false, bundles: 'template' })` 组合 `PROFILE_TEMPLATES[name]`；该名称没有模板时使用 `DEFAULT_PROFILE_BUNDLES`，并且从不写回 `dsh.profile.bundles`。模板加载只读取磁盘上的清单、不改写它，然后解析 `PROFILE_TEMPLATES` / `DEFAULT_PROFILE_BUNDLES`。profile 与 home 的 `cordis.patch.yml` 都不读取；`--patch` overlay 与 telemetry 开关仍然应用；不安装 `watchUserPatches`，否则 HMR（热模块替换）会把跳过的层重新热加载回来。`--dump-default-config` 仍是「清单上的组合包层、无用户文件、无 `--patch`」；跳过栈用 `--skip-user-plugins --dump-config` dump。这两个旗标互斥。这不会按 loader id 禁用插件、隔离包装，也不会改变 Cordis 的响亮失败语义；需要在用户层失败后启动官方 Web 的宿主，对同一 `$DSH_HOME` 做这次二次 spawn。profile 组合本身仍由 [profile 插件组合包](2026-08-05-profile-plugin-bundles.zh.md) 决策负责。

## Alternatives considered

- **把用户 `include` 行做成 fail-soft** — 会把坏掉的插件藏进仍在运行的树里，并改变其他组合所依赖的响亮失败约定。
- **对最内层 loader id 自动写 `disabled: true`** — Cordis 会把 apply 失败包进 `include` / `modules` / 官方 `tools`；`cannot get property "tools"` 里的 `tools` 是服务名，group 行会忽略 `disabled`。
- **临时 `$DSH_HOME`，或在同一 home 上换端口探测** — 会与 session、profile 修复、patch 监视器和 Windows 文件锁竞态；一份 home 同时只由一个 Loader 使用。

## Consequences

宿主可以在不改写用户 profile 的情况下恢复官方 Web；跳过栈可被 dump 检查，并且不会监视它跳过的文件。仍需要桌面专用 insert（不是组合包）的宿主必须把它作为 `--patch` 传入，因为恢复启动不再读取 profile patch 文件。`--dump-default-config` 并不描述跳过启动，因此要看那棵树应使用 `--skip-user-plugins --dump-config`。

## Testing

`packages/boot/app-boot/tests/profile.spec.ts` 钉住模板选择在无法解析的额外名称下的行为、安装自有 headless 三元组不被改写，以及名称没有 `PROFILE_TEMPLATES` 条目时使用 `DEFAULT_PROFILE_BUNDLES`。`apps/cli/tests/args.spec.ts` 钉住解析路由以及与 dump-default 的互斥。`apps/cli/tests/profile-boot.spec.ts` 与 `apps/cli/tests/dump-config.spec.ts` 钉住跳过组合、`--patch` overlay、空监视列表，以及省略用户 YAML 的 dump 标签。
