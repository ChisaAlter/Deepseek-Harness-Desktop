# dsh-pet-indesktop 深度审查与本项目结合计划

> 对象仓库：<https://github.com/MerZlin/dsh-pet-indesktop>（425★，v4.2.0，main 为 v4.2.1 候选）
> 本地审查副本：`C:\Users\48818\AppData\Local\Temp\dsh-pet-indesktop`（约 52k 行 Python，106 段 WebM，1950 测试）
> 本侧落点：feature card `desktop-live2d-pet`（`src/main/desktop-live2d.js` + `src/renderer/pet-live2d.js`）
> 结论先行：**不合并代码库，分六个阶段移植其交互/工程能力**。技术栈不同（PySide6+WebM vs Electron+THA4），直接可移植的是纯函数物理、台词数据结构与事件协议词汇。

---

## 1. 对方架构审查结论

### 1.1 渲染路线：罐头 WebM，不是模型

- 素材 = 106 段 640×360/24fps VP9+alpha WebM，按目录分类：`idle/`(1) `move/`(3) `drag/`(1) `click/`(5) `turn/`(1) `random/`(**89**) `events/`
- 解码 = 内置静态 ffmpeg 子进程（imageio-ffmpeg），reader 线程 → 有界队列 → QTimer 消费；`-stream_loop -1` 常驻进程循环
- 他们为此付出的治理成本（我们的 ONNX 路线天然免疫）：圈边界每 10min 重建进程清内存爬升（47→64MB）、退役 reader 池 + 孤儿进程双兜底补杀、Windows 关机会话冻结派生（防 0xc0000142）、同角色多窗共享一条解码链（帧扇出环形缓冲 cap=4 drop-oldest + 发布者 handover）

**判定**：动作广度碾压我们（89 段 vs 10 立绘），但全是罐头——无视线追踪、无连续微动、动画切换即跳变。我们 THA4 更"活"，离散动作更弱。**两条路线互补，不是替代关系**。

### 1.2 物理层（`physics.py`，210 行纯函数，禁 Qt 红线有测试守）

| 能力 | 对方 | 我们现状 |
|---|---|---|
| 拖拽 | 过阻尼弹簧 k=200/c=30（ζ≈1.06）跟手 | 光标钉死，无弹簧感 |
| 松手初速 | 150ms 拖尾窗：端点均速×0.5 + 峰值分段速×0.5 + 末段加速增益≤60%，soft-knee 软上限 | 瞬时速度，较糙 |
| 抛掷 | 重力 1400px/s²、恢复系数 0.78、地面摩擦 2.5、静止判定 | 已有但常量不同 |
| 弹弓 | 拉距→各向异性变形→ease-out 发射速度 | 无 |
| 多窗碰撞 | 文件锁选主 + QLocalSocket 星型 IPC + 纯 Python 冲量求解（恢复 0.82、摩擦 0.08、面积加权质量、拖拽=无限质量） | 无（单宠） |

**判定**：physics.py 可近乎机械翻译成 JS。多窗碰撞的 IPC 复杂度我们不需要（单进程单 canvas，多宠只是多画几个 drawPos）——**多宠对我们反而更简单**。

### 1.3 气泡系统（独立 QWidget 窗口，非 canvas 绘制）

- **可交互**：审批/提问气泡内有真按钮（FlowLayout 折行），多问题项、`interaction_id` 并发并存，点击 POST 回 `/api/respond` 闭环
- **分页**：长文本按 ≤3 行分页 + 页点 + 按字数自适应停留（1.2s+60ms/字，clamp 2.5-8s）；孤行控制（末页 1 行时从前页匀一行 3+1→2+2）
- **避头尾**：行首禁则字符集比我们多 ASCII 闭标点 `,.;:!?)]}` 和 `·～`——**我们漏了这几个**
- **定位**：7 个候选位（top/top_left/top_right/left/right/bottom/center）+ 不遮角色约束 + min-overlap 兜底打分——比我们"上→下翻"两选一精细
- 宽度预算 slack=4px 防亚像素行尾切字（他们踩过行尾字被裁的 bug，#109）

### 1.4 台词系统（data-over-code，值得我们抄结构）

- 文案零代码内嵌：`pet/persona_presets/{legacy,whale_maid}.json`，事件→≤8 变体、≤240 字
- **安全模板渲染**：`{name} {sessionName} {tool} {command}` 占位符走受限字段路径解析（禁任意属性访问），未知占位符原样保留；`autohide` 字段缺失时整段隐藏并清理残壳
- **按 Agent 分层**：`{global:{...}, agents:{claude:{...}}}`，agent 专属覆盖全局
- 公共事件集（余额/桥接安装）与 agent 专属事件分离，设置页编辑时按层过滤
- PhrasePicker 是简单轮换 `(last+1)%n`——**我们的洗牌袋无重复保证比他们强，保留我们的**

### 1.5 Agent 联动（他们的护城河，我们目前是零）

- **本地 JSONL 事件总线**：`<config>/agent-events/<agent>.jsonl` 追加写 + byte-offset tail（不回放历史、半行缓冲、64KB 有界读）
- **六态词汇**：`thinking/working/attention/error/idle/sleeping`，多 agent 按 attention>error>working>thinking>idle 聚合
- **桥接插件**：零外部依赖硬红线（曾因声明依赖导致全 profile 起不来的事故），Cordis 插件内订阅 agent 事件 + mux WebSocket `127.0.0.1` 中继，回写 `POST /api/respond`
- **分析检测器**（只提醒不打断，verdict 恒 REPLAN）：BehaviorPatternDetector（工具分 EXPLORATION/ACTION，W6/W10 滑动窗，纯探索无产出也算风险）、ExplorationWatchdog（session 级风险评分）、StuckDetector（连续失败/超时指纹）
- **概率门**：每事件类 0-1 滑块控气泡密度，检测链不采样
- **DSH 富状态**：thinking(带 reasoning)/working(带工具名)/waiting_approval/waiting_question 锁存——等用户时后续普通状态不顶掉等待态

### 1.6 工程纪律（可学的部分）

- 架构红线即测试：纯逻辑禁 Qt、fanout 单向依赖、`window.py` 私有面冻结、行数预算（4429 行实测校准）、孤儿文件守卫
- CI 成本纪律：时序测试禁固定 sleep、必须事件同步+宽预算；一族连红两轮即隔离出主套件
- 配置键三处登记：默认值 dict + reload 白名单 + schema 快照测试
- 我们的 feature-card / design-language 体系同思路；缺的是**红线测试化**和**配置 schema 快照**

### 1.7 素材许可红线

- 代码 MIT 可自由参考/翻译
- 角色素材「溟月」（画师上善无形，社区整理）**CC BY-NC-SA 类，仅限个人非商业**——不可打进我们的发布包。89 段 random 动作清单可作我方立绘的**选题目录**（概念不受版权保护），画面必须自制

---

## 2. 结合总策略

**原则**：他们验证了"桌宠+AI Agent"产品形态的天花板，我们验证了 THA4 神经渲染路线的可行性。结合 = 把他们的**交互深度与工程结构**移植到我们的**神经渲染底座**上，并在 Agent 联动上利用我们身处 Harness 进程内的主场优势超越他们（免桥接插件、免 JSONL tail——主进程直接拿事件）。

**用户确认的产品红线（2026-09-14）**：
1. 联动必须是**进程内直连**——pet 就在 DSH 桌面应用内部，不引入任何外置程序/独立进程（对方"独立 Python 程序 + JSONL 桥"的形态明确不要）。
2. 新增**Token 投喂 + 成长值系统**：鲸鱼娘可以吃掉 Harness 实际消耗的 token，转化为成长值（见 Phase E）。
3. 多宠不要（Phase G 已裁剪）。

每阶段独立可交付、可回滚；全程遵守 feature card 流程（改契约先改卡）。

---

## 3. 分阶段计划

### Phase A — 物理手感移植（纯收益，零契约变更） ✅ 2026-09-14 已完成

已落地 `src/renderer/pet-physics.js`（22 常数 + 10 函数，94 用例 Python 金标准 fixture，18 测试全过）并接入渲染器：拖拽中悬挂立绘锚定 `physPoint`（过阻尼弹簧跟手）、松手拖尾窗估算初速、超死区速度进入弹道飞行（重力+边缘反弹+地面摩擦+静止判定后落地持久化）、空中可抓取、跨屏跳轉重置弹簧。`pet-live2d.test.js` 新增弹簧跟手/弹道落地/慢放原地三例集成测试。

**移植** `physics.py` → `src/renderer/pet-physics.js`（纯函数模块，同他们的无依赖红线）：

| 函数 | 用途 |
|---|---|
| `springVelocity` | 拖拽跟手：drawPos 以过阻尼弹簧追踪光标（当前是钉死） |
| `estimateReleaseVelocity` | 松手初速：拖尾窗 + 峰值加权 + 加速增益 + soft-knee |
| `throwStep` / `isAtRest` | 抛掷积分 + 边界反弹 + 地面摩擦 + 静止判定 |
| `softClampSpeed` / `THROW_STRENGTH_CAPS` | 力度档位（gentle/standard/strong/crazy） |

**适配点**：我们窗口不移动（全屏 canvas），物理驱动 `drawPos`；落地静止后 persist 位置。抛掷中沿用现有翻滚 + 头晕星星。

**测试**：用 Python 跑对方 physics.py 生成参考轨迹 fixture（20-30 组输入输出对），JS 移植逐值比对——跨语言金标准测试。加进 `pet-live2d.test.js`。

**可选增强**：弹弓模式（拉拽距离→变形→ease-out 发射）作为 Phase A2，需要拉伸渲染支持。

### Phase B — 台词系统外置（data-over-code） ✅ 2026-09-14 已完成（用户自定义层待接线）

已落地 `src/renderer/dialogue/whale_maid.json`（300 句逐字外置 + `idleTopics`/`timeOfDay` 区间表）与 `src/renderer/pet-dialogue.js`（`load`/`createSayer`/`renderTemplate`/`categoryForHour`/`loadUserOverrides`，21 测试全过）。渲染器 `say()` 改为 PetDialogue sayer（洗牌袋防重保留），时段类目改由 JSON 的 `timeOfDay` 区间表驱动；`pet://pet/` 原生服务 `src/renderer/**`，JSON 免协议改动。

**遗留**：`userData/pet-dialogue.json` 用户覆盖层——`loadUserOverrides` 已实现但缺主进程喂文件的 IPC/协议别名，用户自定义台词暂不可用。

### Phase C — 气泡 v2（交互基础）

1. **避头尾补全**：行首禁则集补 ASCII `,.;:!?)]}` + `·～`（他们踩过坑的完整集）
2. **候选定位**：移植 `bubble_rect_for_anchor` 7 候选位 + 不遮角色约束 + min-overlap 兜底——解决"贴左/右边缘时气泡遮挡角色"场景
3. **分页**：移植 `paginate_bubble_text`（≤3 行/页、孤行重平衡、页点 ●○、按字数自适应停留 1.2s+60ms/字）——为 Phase D 的长事件文本/多问题项铺路
4. **行宽 slack**：measure 累加留 4px 余量（他们修过行尾裁切，我们的 stub 测不出这类亚像素差）
5. **（可选）气泡内按钮**：canvas 内按钮命中区（不入 pet hit-area，悬停时由 renderer 自行 hit-test 上报主进程切交互态）——Phase D 审批的载体；本期先把命中框架做出来

### Phase D — Harness 状态联动（主场优势，契约变更）

> **需先改卡**：`desktop-live2d-pet.md` 现有 "不读取会话" 不变式需要修订为 "只读事件元数据（session id/工具名/状态），不读消息正文"；仍纯本机、不外发。改卡需用户确认。

**事件通道（用户已确认：进程内直连，不做外置程序）**：

- **主路线**：主进程内直接订阅——查 `vendor/deepseek-harness` 的 session-controller 事件面（`SessionEventSource`、`attached.snapshotEvents()` 已确认存在），主进程 → pet 窗口 IPC 推送。零插件、零文件 tail、零 ws。
- **兜底路线**（仍在进程内，非外置程序）：对方的 `integrations/dsh-pet-bridge` 是 Cordis 插件，可经我们已有 `--patch` overlay 机制挂进 `dsh-home` profile——插件跑在我们自己的 Harness 进程内，不算外置程序，但 JSONL tail 是绕路，仅当主路线 spike 失败才用。**spike 任务**：验证 vendored dsh 的 `apiProxy`/mux 事件兼容性。

**六态映射**（沿用对方词汇，对齐社区协议）：

| 状态 | 桌宠表现 |
|---|---|
| `thinking` | live 模型 + `idleCoding` 类气泡（概率门控） |
| `working` | 工具名映射台词 `{tool}`，可选 running 立绘短促出现 |
| `attention`/`waiting_approval` | **常驻气泡 + 批准/拒绝按钮**（Phase C.5 命中区），点击经 IPC 回写主进程 |
| `waiting_question` | 多问题项气泡（分页承载） |
| `error` | concerned/angry 立绘 + error 类气泡 |
| `idle`→完成 | celebrate 立绘 + `done.success` 气泡 |
| `sleeping` | 静默 |

**台词新增层**：JSON 加 `agents.harness` 专属层（activity.read/edit/run/search、approval.*、done.*、error.* 事件键，复用对方事件词表）+ `{tool} {sessionName}` 占位符。

**概率门**：config 每事件类 0-1（默认 activity=0.6 余 1.0），检测不采样只采气泡步。

**不做**（本期）：BehaviorPatternDetector/Watchdog/Stuck 检测器（对方也是后加的，先跑通事件链再谈智能）、主动识屏、余额查询（desktop 已有 usage-stats 面板）。

### Phase E — Token 投喂与成长值系统（用户新要求）

**概念**：鲸鱼娘的人设就是"吃算力"——把 Harness 真实消耗的 token 当成她的口粮。成长值驱动台词池、动作、外观装饰逐级解锁，形成"用得越多她越强"的陪伴循环。

**数据源（进程内，无需网络）**：

- usage-stats 已有消费记录面（`docs/features/usage-stats.md`，step 级 token 计量、UTC 日桶）——主进程读**聚合计数**，不读消息正文（与 Phase D 同一隐私线）
- 投喂方式二选一（建议都做）：
  - **自动**：每会话/每日结算时 token 消耗按比例流入成长值（睡了一觉醒来她"偷偷吃了"你今天烧的 token）
  - **手动**：右键菜单「投喂 Token」→ 弹出今日可投喂额度 → 吃相立绘（复用 eat）+ 数字气泡「吃掉 1.2k token，成长值 +12」

**成长值模型**：

- `growth = Σ fedTokens × rate`（rate 如 1 成长值/100 token，可调）+ 互动小加成（摸头/喂食米饭每次 +1，日上限防刷）
- 持久化 `config.live2dPet.growth = { exp, level, fedTokensTotal, lastAutoSettleDay }`，原子写
- **只增不减**；自动结算按日去重（`lastAutoSettleDay`），重装/重启不重复入账

**等级与解锁**（初版曲线可校准）：

| 等级 | 称号 | 解锁 |
|---|---|---|
| Lv1 | 幼鲸 | 基础 30 类台词 |
| Lv2 | 小鲸 | `feedToken`/`levelUp` 台词池 + 气泡旁等级徽记 |
| Lv3 | 干饭鲸 | 投喂专属吃相动作 + 新 idle 台词主题 |
| Lv4 | 鲸鱼娘 | 微放大体型 +5%（视层级）/ 头饰挂件 |
| Lv5 | 大肥鱼（自称） | 彩蛋动作 + 全部池解锁 |
| Lv6 | 深海霸主 | 稀有台词 + 粒子特效皮肤 |

- 升级瞬间：celebrate 立绘 + `levelUp` 气泡「成长值满了！本小姐升级了！」
- 展示：右键菜单显示「Lv3 · 成长值 xxx/yyy」进度；悬停/气泡内不带常驻 UI

**台词新增类**：`feedToken`（投喂时）、`levelUp`（升级）、`growth`（被问等级时/随机凡尔赛）。

**防滥用**：成长值只认真实 token 消耗与受限互动次数，不接受用户手输数字；日结去重。

### Phase F — 省电与隐藏策略

1. 桌宠窗口隐藏/不可见 → 停 ONNX 推理 + 全部定时器（对方实测隐藏后 CPU≈0%）
2. 闲置 30s+ 半帧率推理 + 停小动作/粒子预热，交互即回满
3. 睡眠态已有的节流正式化为 `powerMode` 状态（active/drowsy/sleeping/hidden）

### Phase H — 动作库扩展（产能问题，独立于代码）

- 把对方 `random/` 89 段清单当**选题目录**（不可拷素材——CC BY-NC-SA），挑 15-20 个高价值动作自制立绘：写代码、偷吃被抓住、抛接球、跳舞、睡觉沉眠、吃螃蟹/月饼（节日）、变鸽子、敲桌面、玩魔方、堆雪人
- 自制路径：AI 生图按现有立绘风格 prompt 链 → 人工挑选 → `pet-live2d/states/` 落位 → 状态机挂载点照 `random` 动作池机制（我们的 flourish 已支持轮换）
- 远期可选：动作立绘升级为短帧序列（APNG/sprite sheet），canvas drawImage 逐帧

### Phase G — 多宠（已裁剪，用户确认不需要）

~~单进程多 canvas 实例 + 进程内碰撞~~。用户明确不需要多宠；`collision.py` 冲量求解器仅在 Phase A 抛掷物理中用到，多窗 IPC 部分整体不移植。

---

## 4. 明确不拿清单

| 对方组件 | 不拿原因 |
|---|---|
| Qt/PySide6 全栈 | 技术栈不兼容 |
| ffmpeg/WebM 解码链 | 我们 THA4+立绘路线更轻，不引入视频栈 |
| 角色素材（溟月 WebM） | CC BY-NC-SA 非商业，发布包不可用 |
| AI 对话窗口 | 我们本身就是 DSH 应用，对话在主窗口 |
| 设置对话框 | 我方设置体系不同；pet 设置项先进 config.json，需要 UI 时接桌面设置页 |
| 主动识屏/视觉模型 | 隐私面大，且 desktop 有完整会话视图 |
| 打包/发布体系 | 我们走 Electron 安装器 |

## 5. 风险与对策

| 风险 | 对策 |
|---|---|
| 桥接插件在 vendored fork 上 API 不兼容 | Phase D spike 先行：先验证 `apiProxy`/mux 存在；首选直接主进程订阅，插件只是备选 |
| "不读取会话"契约变更的隐私面 | 事件只带 sessionId/toolName/状态，不带消息正文；卡片修订需用户确认；全部本机内存态不外发 |
| 气泡按钮扩大命中区破坏 click-through | 命中区由 renderer hit-test 动态上报（现状已是该机制），气泡无按钮时不上报 |
| 物理移植手感回归 | Python 参考轨迹 fixture 金标准测试；保留旧路径开关一版（`config.live2dPet.springDrag=false` 回退） |
| 动作立绘产能 | 先 15-20 个高价值动作；AI 生图+人工选；版权红线已写明 |
| 范围蔓延 | 每阶段独立 feature 提交，独立可回滚；Phase F/G 不影响主链路 |

## 6. 建议执行顺序与验证门

```
Phase A（物理）→ Phase B（台词外置）→ Phase C（气泡 v2）
    → Phase D（Harness 联动，需改卡确认）
    → Phase E（Token 投喂 + 成长值，依赖 D 的数据通道）→ Phase F（省电）
Phase H（动作库）可与 B-F 并行（纯产能）
Phase G 多宠已裁剪
```

每阶段门：`node --check` + 相关测试绿 + feature card `last verified` 更新 + 重启应用目检。Phase A 另需 Python-JS 轨迹比对全过。Phase E 另需成长值持久化/日结去重/升级解锁的单元测试。

## 7. 首个落地动作

Phase A + B 无契约争议、纯收益、可立即开工。

用户已确认的边界（2026-09-14）：
- ✅ 联动进程内直连，不外置程序（Phase D 主路线：主进程订阅 session-controller 事件面；桥插件仅作进程内兜底）
- ✅ Token 投喂 + 成长值系统（Phase E）
- ❌ 多宠（Phase G 裁剪）

待确认项：
1. pet 卡片 "不读取会话" → 改为 "只读 Harness 事件元数据与 token 聚合计数（不含消息正文）"？（Phase D/E 共同的隐私线）
2. 成长值解锁表与称号文案是我上面给的草案——等级数、解锁内容、投喂转换率都可调，有想法就说。
