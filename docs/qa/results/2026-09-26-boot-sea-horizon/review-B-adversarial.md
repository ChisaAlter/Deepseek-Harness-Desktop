# 对抗审查报告 B —— 专职找茬（独立子代理）

- 对象：提交 `d00d528ffca`，对照定稿原型 `boot-redesign-b2-horizon.html` 与本目录证据
- 方法：逐项推翻交付声称、构造反例时序/输入、核对证据真实性（无 exec，静态+证据分析）
- 日期：2026-09-26

## MAJOR 发现（3）

1. **快照重放截断流式缓冲**（同 A-P1，独立发现）：`slice(-80)` + `replaceChildren` → >80 行会话中每次 state push 抽屉回缩、L NN 回跳。「完整日志」承诺在触发路径上不成立。
2. **快照重放与 60ms `shell:log` 批 flush 二次送达 → 重复行 + 计数虚高**：`dsh.log()` 同步入 ring、批 60ms 窗口内 `sendState` 携快照先达，flush 后又送同一批——错误路径几乎必现。所有 stub 测试的 onLog/onState 分离注入，覆盖不到这个时序交错。
3. **`.caption` 全宽 z9 压 `.window-controls` z5 → 窗控三键命中测试死区**：视觉可见、点击既无动作也无拖拽。原型与 launcher 惯例均为 `right:120px` 让位；生产 `width:100%` 是实质偏差。且既有 QA 用 `el.click()` 程序化点击绕过命中测试，「窗控可点」从未被真实验证。

## MINOR / NIT

- 「取消失败」文案被 250ms 倒计时覆盖（同 A-P2）；`openLauncher {ok:false}` 静默（同 A-P7）；`nextRetryAt` 畸形 →「NaN 秒」（同 A-P9）
- `applyPluginBootCopy(failed)` 留无动作 error 屏且 `failureEl` 陈旧（遮盖兜底，时序缝隙可见死端）
- 空 `logs:[]` 不刷计数；`#log-count` 初始为空而非「0 行」；抽屉顶部 48px 遮罩点击落在 caption 拖拽区；超长行无折行；`.core pointer-events:none`（原型一致）

## 被推翻的交付声称

- 「四件动作直接出现在场景中央」→ 任一时刻最多 3 件同屏（cancel 仅 scheduled、跳板仅非 in-flight error）→ 措辞改为「动作集按态出现」
- 「抽屉承载完整日志（上限 400）」→ 交付版被 MAJOR-1/2 证伪
- report.md「真机 ticker L 25」→ real-probe.json 实为 08`L 00` / 09`L 20`，无 L 25 记录
- 「探针读 #ticker-count」→ probe.json `count` 字段实为 `#log-count`（"7 行"），两种语义混名
- 「`data-boot-theme` 切换」→ 明暗开关实为 `data-ds-dark-theme`

## 需求降级结论

视觉要素逐项与原型等价无缩水；短窗压缩生产用 `@media(max-height:700px)` 实做（原型仅演示框），反超原型。唯一实质偏差 `.caption right:120px→width:100%`。

## 疑点

1. caption 遮挡是新回归还是存量（后核：8404f74 已是 width:100%，存量缺陷）
2. 审查期间工作树漂移：主代理并行修复中（snapLast 守卫/actionNotice 等），报告按交付版定案
3. 重复行真实触发率需真机佐证（机制在代码层确定）
4. cases.json/pixel.json 未纳入 report；px-diff-light 缺（已补拍）
5. 真机仅 covered/starting 两态，error 动作/抽屉/窗控点击/明暗切换全真机未验证

## 建议

caption `right:120px`；批 flush 与快照重放序号去重；pluginBoot-failed 补文案/动作；report.md 事实修正；「四件动作」改「动作集按态出现」；补真指针命中窗控 QA 用例。
