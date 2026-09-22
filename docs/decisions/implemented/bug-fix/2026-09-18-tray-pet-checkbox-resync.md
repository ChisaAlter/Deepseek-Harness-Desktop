# Decision: 托盘桌宠勾选随真实开关状态重建

Status: implemented

中文 | [English](2026-09-18-tray-pet-checkbox-resync.en.md)

## Problem

托盘「桌面宠物」复选框的 `checked: petEnabled()` 只在 `createTray` 一次性 `Menu.buildFromTemplate` 时求值，是构建期快照。宠物面板「🌙 隐藏」（`shell:live2d-hide` → `setEnabled(false)`）与主窗设置页开关都绕过托盘菜单，勾选停留在旧值——用户右键托盘看到仍亮着的勾，须先点一次把它拨掉（实际是一次重复 disable），再点一次才真正重新召唤。

## Decision

`setEnabled` 是所有开关面（宠物面板、设置页、托盘复选框自身）汇聚的唯一漏斗：管理器新增 `options.onEnabledChange` 回调，每次翻转后携带新值触发；`index.js` 将其接线到 `tray.js` 新增的 `refreshTrayMenu()`——`createTray` 把模板参数存档为 `trayMenuParams`，回调到来时以最新 `petEnabled()` 重新 `buildFromTemplate` + `setContextMenu`，托盘未创建时静默 no-op。

## Alternatives considered

- **点击时按 `petEnabled()` 真值取反，不重建菜单** — rejected：能修「点两次」的语义，但勾选显示仍旧说谎（宠物已隐藏仍亮勾）——显示态与真值脱节本身就是要修的 bug。
- **`tray.on('right-click')` 弹出前重建** — rejected：Windows 上 `setContextMenu` 接管右键、该事件不保证发射；菜单弹出途中重建时机不可控。
- **在各 IPC 入口分别调 refresh** — rejected：`shell:live2d-hide`、设置页以及未来新增的开关面每处都要记得同步调用；漏斗内一处回调覆盖全部现有与未来路径。

## Consequences

代价：主进程新增一条 manager→shell 回调契约（`onEnabledChange(enabled)`）；托盘菜单对象每次翻转整体重建（菜单极小、翻转罕见，成本可忽略）；回调异常由漏斗内 try/catch 吞掉，不反向污染 `setEnabled`。收益：勾选永远反映 `live2dPet.enabled` 真值——宠物面板隐藏后右键托盘即见未勾，单击一次直接重新召唤；设置页开关同理。`node --test` desktop-live2d 34 pass（+1：`onEnabledChange` 翻转序列），pet-live2d 33 pass。
