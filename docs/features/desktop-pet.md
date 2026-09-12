# Feature: Desktop Pet

| Field | Value |
| --- | --- |
| **id** | `desktop-pet` |
| **status** | `hidden` |
| **last verified** | 2026-09-12 — `DESKTOP_PET_FEATURE=false` 隐藏，托盘项与挂载均不出现 |

## User paths

1. Harness ready 后默认看到一个小型桌面宠物；点击它会有一次轻量反馈。
2. 拖拽宠物改变位置；窗口缩放、最大化或恢复后宠物仍在安全区域。
3. 托盘「桌面宠物」checkbox 可关闭或重新开启；开启状态、选中的 Codex 宠物与归一化位置在重启后恢复。
4. 自动发现 `${CODEX_HOME:-$HOME/.codex}/pets/` 下的 Codex 宠物目录，选择后无需复制资产即可显示。

## Invariants

- 宠物只存在于 Desktop shell 的小矩形 BrowserView；仅 Harness ready/revealed 时显示，boot、启动器、关闭遮罩和 Harness teardown 期间不存在残影。
- `src/main/desktop-pet.js` 的 `DESKTOP_PET_FEATURE` 开关为 `false` 时不创建宠物 BrowserView、不输出托盘「桌面宠物」项；`configureDesktopPet`/`getDesktopPet` 返回 null，已保存的 `pet` 配置保留以便重开时恢复。
- 不修改 `vendor/deepseek-harness/**`、Harness DOM、插件装配或会话数据。
- 持久化只包含 `{ enabled, xRatio, yRatio, petId }`；NaN、越界或畸形值回退到安全默认，归一化位置在窗口变化后 clamp。
- Codex 宠物导入只接受安全的相对 `spritesheetPath`，并同时兼容 v1 `8x9 / 1536x1872` 与 Desktop v2 `8x11 / 1536x2288` 图集；非法 manifest、路径穿越和尺寸不匹配的包被忽略。
- 宠物视图不能覆盖整窗透明区域；宠物矩形外 Harness 仍可正常点击。
- pet preload 只提供初始状态、位置提交和主题订阅；其它 shell/workspace/Git/文件/远程/插件 API 不暴露。
- 颜色与动效复用 `--dsw-alias-*` / 共享 motion token；不使用 `--boot-*` 或独立色板。

## Allowed touch

- `docs/design-language.md`, `docs/handbook/modules/window-chrome.md`, `docs/qa/production-acceptance-test-cases.md` — 记录 shell overlay 契约与验收。
- `src/main/desktop-pet.js`, `src/main/window.js`, `src/main/config.js`, `src/main/ipc-authorization.js`, `src/main/tray*.js`, `src/main/chrome.js`, `src/main/index.js` — 生命周期、持久化、窄 IPC、托盘和主题装配。
- `src/preload/index.js`, `src/renderer/pet.*`, `assets/whale.svg` — 最小 pet bridge、Codex 图集渲染与 fallback 资产。
- 宠物管理器只读取 Codex pets 根目录并向 renderer 传递已校验的本地图集 URL，不向 renderer 暴露通用文件系统 API。
- 对应 focused tests。

## Do not touch

- `vendor/deepseek-harness/**`、Harness DOM 注入、插件/会话数据结构。
- 全窗口透明 BrowserView、独立宠物窗口、宠物商店/喂养/等级/AI 对话/声音/多宠物。

## Gates

| Kind | What |
| --- | --- |
| Automated | `node --test src/main/desktop-pet.test.js src/main/config.test.js src/main/tray.test.js src/preload/shell-api.test.js src/main/ipc-authorization.test.js`；`npm test`；`npm run smoke:source` |
| Manual / QA | `TC-DESK-010` in [production-acceptance-test-cases.md](../qa/production-acceptance-test-cases.md) |

## Sources

- Design: [design-language.md](../design-language.md#桌面宠物)
- Plan: ChatGPT C2C task `c2c_4e7b`, iteration 0
- Implementation entry: `src/main/desktop-pet.js` and `src/main/window.js`
