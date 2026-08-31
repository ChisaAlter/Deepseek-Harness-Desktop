# Agent Note: 透明主题下 composer seat 不再铺实心底

Status: implemented

[English](2026-08-28-transparent-composer-seat-slab.md) | 中文

## Problem

开壁纸时，粘性 composer seat 会把 36px 渐变落到实心画布色（浅色 `--dsw-static-neutral-bluish-00`，深色 `-950`），避免 transcript 透进输入条。这条规则只认 `html[data-dsh-wallpaper]`。透明主题同样带这个属性，于是深色半边在会话下部铺出一块黑矩形——盖住 seat、统计条和后面的壁纸——而其余 chrome 已经是 0% 填充。

## Decision

实心 fade 加上 `:not([data-dsh-transparent])` 门控。普通玻璃壁纸仍用实心底。透明主题回落到已经 0% solidity 的混色 `--dsw-alias-bg-base` 渐变。

## Alternatives considered

**在 `wallpaper.css` 里用后出现的 `html[data-dsh-transparent] [data-composer-seat]` 覆盖。** 否决：实心色写在 seat 上，要压过 CSS module 类名的优先级很脆；例外应紧挨被切的那条规则。

**玻璃壁纸也改用混色 `bg-base`。** 否决：静态色覆盖本来就是修这个——玻璃下混色 `bg-base` 本身半透明，fade 会消失，transcript 会撞上输入条。

## Consequences

透明主题不再在输入条下铺黑底。普通玻璃壁纸不变。输入卡片仍走自己的表面 token。

## Testing

`composer-seat-wallpaper.client.spec.ts` 断言未加门控的壁纸选择器已删除，`:not([data-dsh-transparent])` 那一对仍指向静态画布色。

## Related

[主题家族外观系统](../feature/2026-08-14-theme-family-appearance-system.zh.md) 拥有壁纸玻璃混色。桌面卡片：`docs/features/transparent-theme.md`。
