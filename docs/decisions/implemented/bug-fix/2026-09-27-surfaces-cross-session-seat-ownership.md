# Decision: 经典右栏跨会话打开按座位归属路由

Status: implemented

中文 | [English](2026-09-27-surfaces-cross-session-seat-ownership.en.md)

## Problem

`workspaces.openPath` 的调用方（聊天文件提及、终端链接）会显式携带发起 Session。经典 surfaces 轨道恢复后，`openClassicSurfaces` 拿着宿主 inject 捕获的唯一一份 store 动作响应所有会话的请求：给会话 B 的文件会写进当前挂载座位（会话 A）的 store 实例里一个以 B 命名的桶——座位既不渲染也不持久化它，打开右栏却看不到新内容，持久化时该页签被丢弃。后续补的归属守卫又暴露更深的缺陷：`entry.inject` 按 binding 对象记忆化、每个会话只执行一次，单槽 `live` 在 A→B→A 的常规切换后停留在旧座位上，导致当前会话的 openPath 全部被拒绝并静默退回 Host 打开。同型的跨会话泄漏还存在于 `dshd-open-surface` 预览事件：`PreviewPanel` 不校验 `detail.sessionId`，外会话事件会导航当前会话已挂载的 Browser；且面板身份取自主视图推导而非自身座位，原生侧栏后台会话的 Browser 页签会错收/错拒事件。全局 `dshd-pending-preview-url` sessionStorage 槽位亦无会话归属，一座位可消费另一座位排队的预览。

## Decision

`live` 改为按座位 binding key 存写器的 `actionsBySeat` Map：inject 每 binding 只跑一次，Map 天然获得每个座位各自会话的写器且不因重访过期；「当前座位」改由 main-view 留存会话判定（与拦截器 `currentSessionId` 同一来源）。请求按目标会话取写器：

- 目标是 main-view 会话：写入该桶并抬开 surfaces 列（同时收起原生栏）。
- 目标是其他已挂载过的会话：通过其座位写器静默入队到该会话自己的桶，不抬栏；这与经典基线“跨会话打开不抬栏、切回即见”一致，修复的是写错实例而非该语义本身。
- 目标座位从未挂载过：返回 false，调用方回落到原 `openPath`（Host 打开），保证文件可见而非消失。
- main-view 会话却取不到写器属布线损坏，维持原有 throw 契约。

`PreviewPanel` 的 `dshd-open-surface` 监听在 `detail.sessionId` 与会话不符时忽略事件；未携带 sessionId 的主进程弹出事件仍广播到当前座位。面板会话身份改读槽位运行时注入的 `sessionId` prop（session-maybe 标准 props，含原生侧栏座位），非座位上下文回落主视图推导。`dshd-pending-preview-*` sessionStorage 槽位增加 `dshd-pending-preview-session` 标签：三处写入方（surfaces、终端、聊天外链）随 URL 写入发起会话并清掉残留的 presentation 标记，消费方仅当标签缺失（无会话写入的既有契约）或等于本座位会话时才领取；错标签的 pending 留给正确座位挂载时消费。带会话标签的 `dshd-open-surface` 事件另经一条集中路由补齐投递：挂载座位只认本座事件，路由器把异会话事件经 `actionsBySeat` 写入目标座位的桶（不抬栏），终端链接仅在目标为当前/无会话时抬栏；未挂载过的异会话座位无从入队，pending 维持原行为（既有窄窗）。

## Alternatives considered

- **异会话请求一律拒绝回落**：修复鬼写但砍掉上游基线的跨会话入队能力，且切回会话时能看到页签的产品语义丢失。
- **在 SurfacesRoot 的 useEffect 里回写 live**：能同样解决单槽过期，但要穿透注入 props 加一条回写通道，比 Map 方案多一层 React 生命周期依赖。
- **PreviewPanel 不校验 sessionId**：保留跨会话导航泄漏，与 SurfacesRoot 侧已做的会话过滤不对称。

## Consequences

会话 A→B→A 重访后 openPath 仍正确落到当前会话；其他会话的引用打开静默进入其页签桶、不打扰当前列；未挂载会话回落 Host 可见打开。预览事件与 pending URL 均按座位归属路由，后台侧栏 Browser 页签不再误导航。新增 spec 钉住 main→background→main 重访、异会话入队不抬栏、未挂载回落、PreviewPanel 会话过滤与 pending 会话标签；契约测试加 `actionsBySeat`/`currentSessionId` 哨兵。遗留：`mini-player` 恢复事件无会话字段（既有，低危）；`actionsBySeat` 条目随座位生命周期不主动剪除（写入可达性已被 `byId` 门挡住）。
