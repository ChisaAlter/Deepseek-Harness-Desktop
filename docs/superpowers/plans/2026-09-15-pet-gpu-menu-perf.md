# 桌宠 GPU 占用 + 右键菜单卡顿 — 性能整改计划

日期：2026-09-15
卡片：`docs/features/desktop-live2d-pet.md`
触因：用户反馈 — 宠物非常占用 GPU；右键菜单非常卡顿。

## 现状诊断（代码走查结论）

### GPU 侧

1. **推理常开 ~20fps**：`pet-live2d.js` 主循环 `gap = 50ms`（省电 110ms），THA4 ONNX 512² 逐帧神经渲染；`powerSave` 默认 false 且只降半 —— 空闲 5 分钟后仍 ~9fps 常跑。
2. **每帧 4MB GPU→CPU 回读**：输出 `rgba_f` float32 CHW（512²×4×4B），WebGPU 路径 `gpu-buffer` + `out.getData()` = 每帧一次 `mapAsync` 管线同步 + 80MB/s 回读。
3. **每帧 ~130 万次 JS swizzle**：CHW→RGBA 逐元素循环 + 独立 alphaMax 扫描，`putImageData`(CPU canvas) → `drawImage` 到全屏 GPU canvas（每帧 1MB 上传）。
4. **全屏透明置顶窗口 + 全屏 canvas**：DWM 对每个损伤帧做整窗 alpha 合成。
5. **vsync 全量重绘**：`tickStill` 在 `sleeping || bubble || panel || still || particles || …` 任一成立时每 rAF `paint()` —— 睡觉态（4min 自动入睡，最常见空闲态）无限期按 60-144Hz 重绘 12 条带 + 粒子；气泡可见时逐字 `measureText` O(n)/帧；面板开着时每帧 ~14 个 emoji fillText + ~10 次 measureText + 15 个 roundRect。
6. **WASM 兜底**：无 WebGPU/WebNN 的机器上单线程 WASM 推理跑满一核。

### 菜单卡顿侧

1. **右键 → `getGrowth` → 主进程同步全量扫描**：`growthSnapshot()` → `growth.refresh()` → `scanSessionTokens`（递归 readdir + 读全部 `session*.jsonl.zstd` + zstd 逐帧解压 + 逐行 JSON.parse）。本机 2.2MB 语料实测 **~300ms**；重度用户可达秒级。期间主进程停摆 = 光标泵/交互切换/全壳 IPC 全部排队。同一扫描还挂在 **60s 定时器**（`rescanGrowth`）和每次投喂（`feedTokens`）上。
2. **面板开着时 vsync 全量重绘**（同上 #5），与 20fps swizzle 大循环抢同一主线程 → 高亮/点击反馈粘。
3. **穿透→交互竞态**：光标进 ±48px 区到 `setIgnoreMouseEvents(false)` 生效 ≤33ms+toggle 延迟，快进快按的首个右键可能落空穿到桌面。
4. **`console-message` → `fs.appendFileSync`**：`openPanel`/交互切换/格点点击/拖拽全在日志路径上同步写 `pet-debug.log`（"temporary instrumentation" 仍在线）。

### 后台常驻损耗

- 光标泵 30Hz：`getCursorScreenPoint` + `win.getBounds()` + 光标在整屏内移动时 ~30Hz `webContents.send`。
- `pet-dsh-watch` 每 2s：递归 readdir+statSync 全部 session 文件 + `write(dsh)` **无条件** → `persist()` → `saveConfig` = 读 config.json + credentials.json（safeStorage 解密）+ 写 config.json + 重写 credentials.json（DPAPI 加密）—— **每 2 秒一次全套**，永不间断。

## 整改方案

### Phase A — 菜单卡顿（先修，症状最尖锐）

**A1. `pet-growth.js`：增量扫描替代全量重扫**

- tracker 闭包内维护 `Map<filePath, {offset, slots: Map<'turn:step', tokens>}>` 文件游标缓存（仅内存；重启=一次全扫，可接受）。
- `refresh()`：目录遍历只做 `readdirSync`+`statSync`（~ms 级）；逐文件对比 `stat.size` 与缓存 offset：
  - `size == offset` → 直接复用缓存 slots；
  - `size < offset` → 截断/原地轮换 → 该文件 offset 归零重读；
  - `size > offset` → 只读追加段，`decodeAppended` 逐帧解码 + `usageSampleOf`/`usageTokens` last-wins 折进该文件 slots；
  - 文件被删 → 丢弃其 slots（语义与现行 per-dir lastWins 全扫一致：删除即失去贡献）。
- 目录总量 = 目录内各文件 slots 之和；总量 = 各目录之和。
- 复用解码：`decodeAppended(slice, frameSizeOf)` 从 `pet-dsh-watch.js` **上移**到 `pet-growth.js`（watcher 已 require pet-growth，反向 require 会成环），watcher 改为 import；`decodeAppendedPlain` 留在 watcher（outbox 是 jsonl 非 zstd）。
- `scanSessionTokens`/`tokensInLog` 保留：冷启动全扫 + 测试对照。

效果：常态 refresh = stat-only（~1-5ms）；追加时只解码新增字节。右键 `getGrowth` 与 60s 定时器同愈，`growthSnapshot` 可保留「快照前先 refresh」的语义而不卡主进程。

**A2. `pet-live2d.js`：按需重绘**

- 引入 `paintDirty` 标志 + `ANIM_PAINT_MS = 33` 动画重绘上限。
- `tickStill` 的每帧 `paint()` 条件收窄为「真动画源」：still 摆动/粒子/feed/come/glide/land/throw/bubble 淡入淡出 —— 且受 30fps 上限节流；`panel`/`settingsOpen`/`bubble`（非淡变期）移出常绘条件，改为事件驱动重绘（open/close/hover/data push）。
- `drawBubble` 换行结果按 `bubble.text` memo（lines/bw/bh 只算一次），消掉每帧逐字 `measureText`。
- swizzle 双扫合一：alphaMax 折进 CHW→RGBA 同一循环。

**A3. `desktop-live2d.js`：`dbg()` 门控**

- `const PET_DEBUG = process.env.DSHD_PET_DEBUG === '1'`；`console-message` 转发与 `dbg` 本体在 release 下 no-op。`render-process-gone`/`did-fail-load` 保留（罕见且是排障命脉）。

### Phase B — GPU 基线

**B1. 自适应推理帧率（`inferGap(now)` 顶层纯函数，可测）**

| 状态 | 帧率 |
| --- | --- |
| 交互中/拖拽/feed/come/action | 50ms（20fps，现状） |
| 清醒且 90s 内有接触 | 50ms |
| 无交互 >90s（sleepy 下垂期） | 125ms（8fps） |
| `powerSave` 且 >5min 无交互 | 500ms（2fps，比现在 110ms 更深） |
| still 全遮盖（睡觉等） | 不推理（现状保留） |

光标接触即 `idle.lastInteract` 刷新 → 立刻回 20fps，无体感降级。决策点 D1：非省电模式也吃自适应降帧（建议：是，属修复性质）。

**B2. 模型输出整形（可选大赢，需 `C:\Ai\tha4` 管线重出 `model.onnx`）**

图尾加 `Transpose→NHWC` + `Cast→uint8`（值域 *255 钳制已在图内的话只加 transpose+cast）：回读 4MB→**1MB**，`getData()` 回来直接 `outImage.data.set(raw)` 一次 memcpy，删掉整个 swizzle。同时把 `results` 取值换成新输出名。
若暂不重出模型：接受 A2 的单扫优化即可。

**B3. WASM 兜底降频**：`sessionOnGpu === false` 时 `inferGap` 下界放到 250-500ms（2-4fps）——宁可她动得慢，不吃满一核。

### Phase C — 后台常驻损耗

**C1. `pet-dsh-watch.js`：脏检查 + 低频落盘**

- `poll()` 内 `dirty` 标志：语义字段（openTurns/dayTokens/milestone/activeSince/lastSeenAt/state）变更或文件游标剪枝才置位；纯 offset 前进不算脏。
- `if (dirty || now - lastWriteAt > 60000) write(dsh)` —— 崩溃至多重演一分钟追加段，语义安全（watcher 自带幂等水位线）。

**C2. `desktop-live2d.js`：`persist()` 去重**

- `lastPersistedJson = JSON.stringify(state)`，未变则跳过 `saveConfig` —— 覆盖 dsh 每 2s、care、growth 等所有写路径；`config.js` 共享面不动（把 credentials 写跳过留给 launcher/infra 卡另行处理）。

**C3. 光标泵**：维持 33ms（视线跟随的产品性能够用）；不扩 `CURSOR_PET_PAD`（扩大=多吃穿透点击）。首个右键落空属已接受的 ≤33ms 竞态 —— 记录为已知行为，不在本期修。

## 测试与验收

- `pet-growth.test.js`：增量 = 全量对照（追加第二帧后 refresh 两次结果一致；截断归零重读；文件删除贡献消失；v1/v2 迁移目内 last-wins 不双计）。
- `desktop-live2d.test.js`：相同 state 连续 `persist` 只落一次 `saveConfig`；`DSHD_PET_DEBUG` 缺省时 console-message 不写盘。
- `pet-live2d.test.js`（vm+ops 记录基建现成）：`inferGap` 各档判定；面板开着且无动画源时 `tickStill` 不产生 paint ops；气泡 memo 不重复 measureText。
- 全量 `npm test` 绿。
- 实机：任务管理器 GPU% 对比（基线 vs 改后，空闲 5min/30min 各取）；大语料账号右键延迟；拖拽/投喂/面板交互回归。

## 卡片同步（实现后）

- `desktop-live2d-pet.md`：invariant 38（成长扫描改增量折叠 + 每文件游标缓存）、invariant 26（若 B2 落模型整形则更新输出描述）、user path 9（省电档位语义）、`last verified` 刷新。
- 提交前缀按惯例 `feature(desktop-live2d-pet): …`。

## 决策点（已定 2026-09-15）

- **D1** ✅ 自适应降帧对全体生效；省电开关保持更深的 2fps 档。
- **D2** ✅ 本期做模型整形：tha4 管线重出 `model.onnx`，图尾加 NHWC+uint8 输出，回读 1MB、删 swizzle。
- **D3** ✅ WASM 兜底降到 2-4fps。

## 实施顺序

1. A1 增量扫描（主进程，独立）
2. A2 按需重绘 + A3 dbg 门控（渲染器+主进程小改）
3. B1 自适应帧率（渲染器单点）
4. C1/C2 脏检查落盘（主进程小改）
5. （可选）B2 模型输出整形 + B3 WASM 降频

每步独立可合、独立可测，1→4 已经覆盖两条用户投诉的全部根因；B2 是锦上添花。
