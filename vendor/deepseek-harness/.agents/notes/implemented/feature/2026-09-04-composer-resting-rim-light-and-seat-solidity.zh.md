# Agent Note: 输入条静止轮廓光与壁纸座位暗带
Status: implemented

[English](2026-09-04-composer-resting-rim-light-and-seat-solidity.md) | 中文

## 问题

壁纸模式下输入条胶囊读起来是「半边亮」的形状。卡片没有自带的边框光：它的轮廓是 `--dsw-elevation-soft` 画出的 0.5px 发丝描边（`--dsw-elevation-stroke-color` → `--dsw-alias-border-l2`），叠在半透明玻璃填充（`--dsw-specific-input-major`）上。开壁纸后，这条描边只在背后壁纸较亮处可见——典型是顶边（亮发插图正压在卡片后面）——到角前就暗掉了。用户感受到的是「炫光没有覆盖 4 个角」，尽管那道光本就不是谁画出来的。同一模式下，composer 座位在输入卡与统计行背后铺了一条 55% 实底的壁纸色暗带，读起来像输入框底下压着一块重投影。

## 决策

**静止胶囊自带一圈轮廓光，且不带外投影。** `InputBar` 的 `.card` 现在画 `inset 0 0 12px 1px rgba(255, 255, 255, 0.25), var(--dsw-elevation-stroke)`——只有轮廓光加 0.5px 发丝描边；`--dsw-elevation-soft` 完全不上输入条。inset 阴影天然跟随 `border-radius`，一条声明即均匀包住四条边与四个 22px 圆角弧，强度在任何壁纸上都读得出来，与玻璃后透出什么无关。白上加白让浅色主题自然不变、不写主题分支（设计语言禁止功能 CSS 里出现主题分支）。发送/思考炫光（beam）仍在卡片内部画于其上，运行态保留自己强得多的那一层。

**壁纸座位暗带整体移除。** 两条 `html[data-dsh-wallpaper]` 座位填充规则与 `--dsh-composer-seat-wallpaper-solidity` 档位一并删除；任何壁纸模式下 composer 座位都不再铺填充，输入卡与统计行直接坐在壁纸上。钉版 spec 改为断言「不存在」。

设计语言（docs/design-language.md / design-language.en.md）钉下新轮廓光值为静止轮廓合同，把输入条从规则 12 的阴影档位里摘出，并记录无座位暗带规则。

## 备选方案

**让运行态 beam 的内侧彩雾沿整圈边框走。** 就本次诉求否决：抱怨的是静止胶囊，且已上线的 beam 描边在光窗经过时本就覆盖圆角弧（无头浏览器按 8 个固定角度逐一验证——每个角被经过时都以饱和彩色点亮）。把 `beamInner` 改写成环形水洗不会改变静止观感。

**渐变描边 overlay 元素。** 否决：inset 阴影一条声明即达同样效果，不加新元素、不做 mask 合成、圆角原生跟随。

**浅色主题用分支关掉这圈光。** 否决——白上加白天然不可见；写分支违反「明暗只发生在主题表」。

**把 elevation-soft 的 alpha 再往下压。** 已被决策取代：轮廓光达到清晰可见的强度后，外投影层从输入卡上整体去掉（0.02 在深色主题下本就不可感知）；elevation-soft 继续服务菜单、对话框与悬浮卡片。

## 后果

深色主题下，静止胶囊在任何壁纸上都有一圈清晰可见的连续轮廓；感知到的「炫光」不再依赖壁纸亮部。以用户的玻璃不透明度（70%）做无头验证：0.25 在四条边与四个圆角弧上量得均匀 ≈+28 亮度（早前的 0.12 只有 +14，用户看不见），内部未受影响、无 bloom。浅色主题渲染不变。座位暗带移除后统计行直接坐在壁纸上——壁纸很花时说明文字的对比从此交给壁纸本身，产品已接受。今后改这两个决策都先改设计语言。部署备注（因为它直接决定了验证方式）：客户端 bundle 以 `Cache-Control: immutable` 提供，且重建 `lib/client.js` 后 URL 不变——重建只有清掉 Electron 的 `Cache` / `Code Cache` 目录才会到达浏览器，仅靠「重建+重启应用」不够。

## 测试

座位钉版 spec（`composer-seat-wallpaper.client.spec.ts`）已重写为钉「不存在」——任何壁纸模式下座位无填充、无 `--dsh-composer-seat-wallpaper-solidity` 档位；没有 ui-conversation spec 钉卡片 box-shadow。聚焦 vendor 套件全绿：`NODE_ENV=test pnpm exec vitest run packages/client/ui-conversation/tests --testTimeout=30000` → 47 文件 / 479 测试通过。重建后的服务端 `lib/client.js` 带新声明（`box-shadow:inset 0 0 12px 1px #ffffff40, var(--dsw-elevation-stroke)`），且只有在清掉 Electron 的 `Cache` / `Code Cache` 目录之后，本次改动才在运行中的桌面端完成端到端验证——见上面的 immutable 缓存备注。
