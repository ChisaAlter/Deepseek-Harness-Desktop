# 启动页品牌锁定排版 — 验证报告（2026-09-26）

## 变更

副标由单行「鲸屿 · DESKTOP」改为两行锁定排版（按用户参照截图）：

- 第 1 行：`鲸屿` 徽块（hairline 描边小砖）独占一行
- 第 2 行：`BASED ON DEEPSEEK HARNESS` 更小字距行（muted）
- 扫光仍只作用于 `Whale Isle` 衬线字标，副标不闪

文件：`src/renderer/boot.html`、`src/renderer/boot.css`、`docs/superpowers/prototypes/boot-redesign-b2-horizon.html`、`docs/design-language.md` / `.en.md`。

## 实测证据

- `brand-dark.png` / `brand-light.png`：stub shell「启动中」态 1440×920 实拍（headless Edge，reduced-motion）
- `px-diff-dark.png` / `px-diff-light.png`：生产↔原型全图差异高亮；`px-brand.json` 计数
  - 品牌区域（x480–960, y260–440）差异 **0 px**（双色）
  - 全图残余 dark 2372px / light 2479px，定位为：窗控三键尺寸差（30px 生产约定 vs 32px 原型稿）、ticker 文案内容差（stub 行 vs 原型演示行）、圆角边缘——均为既有约定/内容差，非几何回归

## 对抗性审查修复

两份独立审查（A 标准符合性 / B 对抗性）发现的同款缺陷已修：

| 问题 | 严重级 | 修复 |
|---|---|---|
| `.brand-tag` `text-indent:-0.4em` 符号错误：匿名 flex item 继承负缩进把徽块→文字 9px 间隙压到 ~4.4px，锁定行偏左 | medium | 用户复核后徽块后文字整体移除（设计要求即鲸屿独占一行），缺陷随元素一并消除 |
| `.brand-sub` 补偿 `0.16em` 只到位一半 | minor | `text-indent` 改为 `0.32em`（居中行全量字距补偿） |
| `.brand` 标题 `letter-spacing:.08em` 无补偿（~1.76px 偏左） | minor | `.brand` 加 `text-indent:0.08em` |
| `.brand small` 未重置透明填充（未来裸文本会隐形） | info | `.brand small` 加 `color` + `-webkit-text-fill-color` |

审查确认无问题的面：扫光不渗入副标（子元素双侧重置不透明色）、`--boot-*` token 双色齐备、短窗 640px 适配、reduced-motion 定格可读、契约测试无旧断言、全仓无 `鲸屿 · DESKTOP` 残留（除历史 QA 报告原文）。

## 门禁

- `node --test boot-recovery.test.js window-harness-cover.test.js`：22/22
- `npm run doc-sync`：8/8（配对 sidecar 已重录、词数预算通过）

## 未验证项

- 真机窗内实拍未单独重截（本变动为纯排版；重启后启动期即生效，窗口期 <1s 难稳定捕捉——以 stub 实拍为准）
