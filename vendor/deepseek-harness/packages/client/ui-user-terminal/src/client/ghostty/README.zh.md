# Ghostty Web 终端

[English](README.md) | 中文

本目录是浏览器侧适配层，对接与 Android 相同的官方 `libghostty-vt` C ABI。
它不是 xterm 兼容层，这是刻意为之。

- `runtime.ts` 持有单例 WebAssembly 实例和运行时 ABI 布局。
- `ghostty-write-pty.wasm` 是 112 字节的回调 trampoline，承载终端产生的 PTY 回复。
- `core.ts` 持有每个终端的 Ghostty 句柄，并把 C ABI 翻译成渲染快照。
- `renderer.ts` 把背景和样式段批处理成 Canvas 2D 帧。
- `surface.ts` 负责浏览器输入、IME、选择、滚动、尺寸、链接和光标闪烁。
- `fonts/` 内置了仅含符号的 Nerd Font（MIT），surface 惰性注册它，这样
  prompt 字形不依赖本机安装的 Nerd Font 也能渲染。
- `vendor/` 只放构建产物，由 `apps/web/scripts/build-libghostty-wasm.sh`
  可复现地生成。上游 pin 与许可证只放一处：仓库根目录的 `native/libghostty-vt/`；
  wasm 在构建信息里嵌入 pin 的 revision，ABI 测试会拿它对照 mobile 的 `VERSION` 校验。

浏览器行为留在这里，终端传输留在既有 client runtime。渲染循环里不要加 React
状态。两个 WASM 产物都是普通的只读资源，不是可执行文件。
