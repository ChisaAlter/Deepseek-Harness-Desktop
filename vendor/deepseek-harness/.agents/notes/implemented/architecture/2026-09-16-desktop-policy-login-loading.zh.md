# Agent Note: 策略登录页加载期间显示本地文档

Status: implemented

[English](2026-09-16-desktop-policy-login-loading.md) | 中文

## 问题

测试部署的登录窗口（[强制更新客户端](../feature/2026-09-11-desktop-mandatory-update-client.zh.md)）直接导航到策略 origin。在该文档提交并绘制之前，窗口是空白的，而远端页面可能需要数秒才出现。用户点击“通过飞书登录”后只看到一个空窗口，没有任何正在进行的迹象——同时窗口必须保持可关闭，也绝不能遮挡已经可交互的页面。

## 决策

[policy-test-auth.ts](../../../../apps/desktop/src/policy-test-auth.ts)把 [renderer/policy-login-loading.html](../../../../apps/desktop/renderer/policy-login-loading.html) 作为窗口的首个文档载入，并在该文档提交之后才请求策略 origin。占位页是随包发布的、自包含的文件，其中唯一的文本是主进程通过 `loadFile` 的 query 传入的文案，因此文案仍由 shell 本地化字典（`policyLoginLoading`）拥有。首个提交的远端文档会替换它。

占位页从不与远端页面共存，因此没有移除步骤，也没有计时器：Chromium 会一直保留占位帧，直到远端文档的首帧就绪；此后窗口归第三方页面所有。重定向链会把占位页保持到最后一个文档提交。窗口仍与之前一样在创建时即显示且可关闭。

只有两处按文件名识别占位页自身的加载，不识别其他任何东西：Session 的 `onBeforeRequest` 过滤器（它会取消策略与飞书 origin 之外的文档请求）以及 `did-fail-load` 处理器（主框架出错时让登录失败）。`will-navigate` 与 `will-redirect` 守卫仍然要求允许的 HTTPS origin，因此远端页面无法把窗口引回本地文件。占位页无法载入不算登录失败：登录请求照常开始，窗口与本次改动之前一样保持空白。

## 考虑过的替代方案

**用 `WebContentsView`（或 `BrowserView`）覆盖窗口，并在页面就绪时移除。** 它能更早显示反馈，也可以在任选信号处移除，但需要第二个渲染器、一个随窗口尺寸变化的位置，以及一个明确的移除时机。可用的移除信号要么偏晚（`did-finish-load` 仍会等待子资源），要么只是猜测（`dom-ready` 可能早于首帧绘制）；而一旦忘记移除，视图就会遮挡可交互的页面。

**通过 preload 脚本向登录页注入覆盖元素。** 这是决策必须排除的做法：它把 shell 拥有的 DOM 层放进第三方页面，并且会给该页面一个隔离 Session 刻意不提供的 preload 桥（`webPreferences.preload` 未设置）。

**在远端页面加载完成前保持窗口隐藏。** 它通过取消反馈来消除空白闪烁，并把用户第一次看到页面的时间推迟到所有子资源完成之后。

**使用原生启动窗口，或把加载文本放进窗口标题。** 为一个两秒的等待增加第二个窗口会带来焦点与生命周期问题，而标题不是窗口内的可见反馈。

**用固定延时揭示页面。** 计时器无法区分慢 origin 与快 origin，结果要么遮挡已就绪的页面，要么在空白页面上取消遮挡。

## 结果

登录窗口给出不依赖网络的即时本地反馈：占位页的 CSP 设置了 `default-src 'none'`，因此该文档没有任何 origin、字体、图片或连接可用。由于占位页是窗口的文档而不是覆盖层，它的任何部分都不会残留到第三方页面中，登录页上缓慢的子资源也无法延长它的存在。

占位页共享登录 Session，因此它的请求会经过同一个文档过滤器；该过滤器的豁免按文件名限定，不会放宽导航所用的允许 origin 检查。窗口标题仍是 shell 拥有的登录标题（渲染器阻止了 `page-title-updated`），因此占位页不贡献自己的文案。

[policy-test-auth.spec.ts](../../../../apps/desktop/tests/policy-test-auth.spec.ts)覆盖顺序（先占位页，只有它稳定后才请求远端页面）、过滤器对占位页的接受、占位页载入失败不得导致登录失败，以及占位页加载期间关闭窗口后绝不启动远端页面。[policy-login-loading.spec.ts](../../../../apps/desktop/tests/policy-login-loading.spec.ts)在 jsdom 下载入随包发布的文档，检查它渲染传入的文案、在没有文案时保持为空，并禁止一切网络来源。占位页的实际渲染帧与替代登录页的首帧时机仍未在真实登录窗口上验证。
