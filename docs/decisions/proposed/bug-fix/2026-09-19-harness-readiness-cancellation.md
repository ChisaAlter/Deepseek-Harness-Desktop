# Decision: Harness 就绪探测的取消信号贯穿嵌套 token 兑换

Status: proposed

中文 | [English](2026-09-19-harness-readiness-cancellation.en.md)

## Problem

`probeHarnessReady` 用同一个 `AbortController` 守卫首次探测与 origin 重试，但当首次响应是 401/302/303 且没有 `Set-Cookie` 时，它会调用 `redeemBrowserSession(url, { fetchImpl })` 完成一次性 token 兑换——这次调用既没有拿到 signal，`redeemBrowserSession` 自己也没有把 signal 传给 `fetch`。结果是：一个卡住的兑换请求可以活过 readiness 预算（默认 1500ms），把启动轮询拖长；`stop()` 递增 generation 使旧代失效时，这个 in-flight 兑换也不受取消影响，继续占用事件循环并晚于停机返回。审计探针记录到 `first=signal` / `redemption=no signal` 的不对称。同样地，`DshManager.waitUntilReady` 只在 `await` 之前校验 generation 与 child 身份；如果探测在 `stop()` 之后才 resolve，它仍可能写入旧代的 `sessionCookie`。

## Proposal

`redeemBrowserSession` 接受可选的 `signal` 并原样传给 `fetch`，`probeHarnessReady` 在嵌套调用处传入自己的 `controller.signal`。readiness 的 `finally` 继续清理计时器，使 signal 与 timeout 共用同一生命周期。`probeHarnessReady` 另外接受可选的**调用方 signal**，并与自身的超时 controller 合成：调用方在进入前已 abort 时，必须在发出任何请求之前抛出其原始 reason；合成后的 signal 必须同时覆盖首次探测、嵌套兑换与 origin 重试三次请求；调用方取消优先于内部超时，内部超时仍返回原有 `{ ok: false, cookie: '' }`。`finally` 同时释放计时器与调用方 signal 上的 abort 监听，避免监听器泄漏。仅把 signal 透传到 `probeHarnessReady` 而不在它内部消费，不构成取消贯穿——中间层转发必须落到真实请求上。`DshManager` 把低层 `probeHarnessReady` 作为可注入依赖，`isReachable` 接受调用方提供的 guard，并在 `await` 返回后、发布 cookie 之前再次校验该 guard；`waitUntilReady` 传入检查 generation 与 child 身份是否仍当前的 guard，并在探活 `await` 返回后、写入 `this.baseUrl` 与返回 ready 之前**再查一次同一 guard**——guard 不能只依赖被注入的探活实现自觉调用，调用方必须自己兜底。新增定向测试：断言三次 fetch（首次探测、嵌套兑换、origin 重试）持有同一个 signal 实例；断言一个永不 settle 的兑换请求会在 readiness 预算内被 abort 并让 `probeHarnessReady` 返回 `{ ok: false }`，而不是拖到调用方超时；断言探测在 `stop()` 后迟到 resolve 时不会写入旧代的 session cookie；并新增一个受控**重叠**用例：让旧代的 helper 在新代已经 ready 之后才 resolve（且该注入实现故意忽略 guard），断言旧 continue 不得覆盖当前代的 `baseUrl`/`sessionCookie`，当前代仍保持 ready。

调用方 signal 的验收必须走**真实链路** `establishLiveSession → probeHarnessReady → 注入的 fetch`，不得把 `probeHarnessReady` 替换成 fake 探针来证明取消：只断言参数转发无法区分「被消费」与「被忽略」。`establishLiveSession` 在 `await` 之后必须再查一次取消，避免探针已返回而父级已取消时把结果当作成功 session，也不得因此再启动一次 token 兑换。

## Alternatives considered

- **给兑换单独设一个更短的 timeout** — rejected：会引入第二个超时预算与第二套取消语义；调用方已有的 signal 就是正确的作用域，再加一层只会让停机路径更难推理。
- **把 `redeemBrowserSession` 的 fetch 改成 `Promise.race`** — rejected：race 只是让调用方提前返回，底层请求仍在跑，取消语义没解决。
- **保持现状，由调用方预算兜底** — rejected：`waitUntilReady` 的就绪预算并不能中断已经发出的 fetch；in-flight 请求会活过 `stop()`，与 generation 失效契约冲突。

## Acceptance criteria

`node --test src/main/harness-browser-auth.test.js src/main/dsh.test.js` 全绿（59/59），其中包含 signal 贯穿、「卡住的兑换被 abort」、通过生产转发链验证的「停机后迟到的探测不得发布 cookie」正反两例（旧代 cookie 不覆盖、当前代 cookie 正常发布），以及「旧代 helper 迟到结算不得覆盖当前代 URL/cookie，当前代仍 ready」的跨代重叠用例；现有 303 兑换后 origin 重试路径行为不变；`redeemBrowserSession` 不传 signal 时的既有调用（如 `dsh.js` 之外的工具脚本）保持兼容。

`node --test scripts/remote-workspace-live-guard.test.mjs` 全绿（8/8），覆盖调用方预取消（断言未发出任何请求）、取消发生在 initial request / nested redemption / authenticated retry 三个阶段，且探针内部超时被设置为显著长于取消触发时间，以证明是**取消**而非内部超时结算了操作；同时断言 abort 监听器在 `finally` 中被移除。该用例若把 caller→timeout controller 的转发改为空实现即失败（已做变异验证），因此取消贯穿有真实回归保护。

## Risks

把 signal 贯穿后，凡是从 readiness 内部触发的兑换都会随 readiness 预算一起被取消；若未来有调用方希望兑换比探测活得更久，需要显式传入独立 signal，而不是依赖默认行为。signal 只在 readiness 窗口内有效，超时后调用方必须重新探测。guard 只保证旧代的探测结果不会被发布，不保证底层 fetch 已停止；真正的请求取消仍由 signal 负责。调用方在 await 后的第二次校验是纵深防御，不能替代被注入实现自身遵守 guard：若某个替换实现忽略 guard，探活阶段可能已发出真实请求，只是其结果不会被采用。
