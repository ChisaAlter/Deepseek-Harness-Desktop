# 模块：终端

## 职责与非目标

**职责：** 底栏（及 surface）终端：PTY 读写、多会话、选区送对话。  
**非目标：** 不把终端做成空态说明卡；不做未承诺的 GPU 嵌入。

## 用户路径

1. `` Ctrl+` `` 打开底栏终端。  
2. 输入命令；选区可送进 Composer。  
3. 多会话 / 分屏（若 UI 提供）；销毁后可重建。

## 架构要点

- Main：`pty.js`（node-pty）。输出不做一 chunk 一条 IPC：空闲后第一个 chunk 立即发布，随后同一 burst 内的 chunk 按 8 ms / 32 KiB（UTF-8 字节）合并成一条 `shell:pty-data`；exit 与 kill 前先 flush，队列随 owner generation 一起清理。Ghostty wasm/字体由 `src/shared/ghostty-assets.js` 放到 `dirname(client.js)/assets/`。
- UI：`dsh-client-ui-user-terminal`（Ghostty 网格，不是空态卡片）。  
- Feature card：[../../features/terminal-drawer.md](../../features/terminal-drawer.md)

## 实现入口

- `src/main/pty.js`：PTY 读写
- `src/main/dsh.js`：源码启动时校验/拷贝 Ghostty wasm（`ghostty-assets.js`）；缺则拒绝 launch
- Preload：`ptyCreate` / `ptyWrite` / `ptyResize` / `ptyKill` / `onPtyData` / `onPtyExit`

## 不变量

- 终端是工作环的一部分，与 surfaces note 一致。  
- 官方终端组件语言：等宽网格。源码启动与 `setup:harness` 必须能提供 `libghostty-vt` wasm，不能 404。  
- 不做未承诺的 GPU 嵌入。
- PTY 不注入桌面 `$DSH_HOME`；终端里的官方 `dsh` 仍走 `~/.dsh`（[dsh-home.md](dsh-home.md)）。
- PTY 生命周期：关抽屉 / 关 tab / 切会话不 kill；kill 仅垃圾桶与 app 退出；renderer reload / `render-process-gone` 时 `pty.js` 按 sender 收割其名下 PTY（`pty-create` 记录属主，`did-navigate` / `destroyed` 同样触发）。
- 输出合并不得改变字节序或丢数据：`shell:pty-exit` 必须排在已缓冲的输出之后；输入写入与 resize 不走合并队列。裸 node-pty 的 `pause`/`resume` 未被证明能约束生产速度，因此当前实现只承诺**合并**，不承诺背压。

## 门槛

- QA：`TC-TERM-001` … `TC-TERM-004`；`TC-CHAT-004`（附录终端轮）

## 延伸阅读

- work-loops Agent Note；[surfaces.md](surfaces.md)
