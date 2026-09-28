# 启动器全面审查报告

**审查日期**: 2026-09-28  
**审查范围**: 启动器全部六个页面、导入功能、插件冲突恢复、UI/字体大小  
**审查方式**: Codex with ChatGPT 联合审查，隔离环境复现  
**基线**: Deepseek-Harness-Desktop / main / 81a41107d16 + 当前脏工作树  

---

## 执行摘要

本次审查发现 **3 个 P1（严重）**、**7 个 P2（中等）** 问题，涵盖导入数据安全、崩溃恢复、UI 排版和可访问性。所有发现均已在隔离环境中复现或经代码审查确认。

---

## P1 严重问题

### F1: 附件导入删除目标独有附件（overwrite=false 时）

**文件**: `src/main/data-import.js:1284-1291,1351-1379`  
**影响**: 用户选择"不覆盖已有"时，目标桌面端独有的附件仍被删除，导致现有会话引用失效。

**机制**: `copyDirAtomic(sourceAttachments, destinationAttachments)` 不检查 `overwrite` 或目标冲突，直接删除整个目标目录后重命名。

**复现**: 源附件 + 目标独有附件，运行 `runImport({importAttachments:true,overwrite:false})` → `ok:true`，但目标独有附件被删除。

**修复方向**: 附件导入应改为合并模式（逐文件复制），而非目录替换；或尊重 overwrite 标志。

---

### F2: 目录替换不是崩溃安全的，恢复可能删除唯一剩余副本

**文件**: `src/main/data-import.js:1284-1291,1167-1264`  
**影响**: 导入过程中崩溃后，旧数据已删除但新数据尚未就位，恢复逻辑会清理 staging 目录，导致数据永久丢失。

**机制**: `copyDirAtomic` 先 `rm(to)` 再 `rename(staging, to)`，中间存在无备份窗口；恢复仅清理 `.import-tmp`，不恢复旧目录。

**复现**: 注入 rename 失败 → 旧目标已删除，staging 保留；恢复清理 staging 后，新旧数据均丢失。

**修复方向**: 使用备份-替换-确认三段式；恢复时优先恢复备份而非清理 staging。

---

### F3: 导入未建立受保护的运行时静止

**文件**: `src/launcher/launcher-service.js:107-116,157-198`；`src/main-launcher/ipc.js:17-33`  
**影响**: 导入期间桌面端可能仍在运行，导致会话/设置/附件被并发修改。

**机制**: `runImportTask` 直接调用 `dsh.stop()`，不使用任务保护协调器；slim 包的 `dsh` stub 没有 `stop()` 方法，返回 false 后仍继续导入。

**修复方向**: 导入应使用与正常停止相同的保护边界；slim 模式需显式拒绝或提供外部停止机制。

---

## P2 中等问题

### F4: 同名技能跨根目录静默替换

**文件**: `src/main/data-import.js:656-687,1450-1482`  
**影响**: `home:foo` 和 `agents:foo` 被视为不同行，但目标名称相同。若目标初始为空，两者冲突标志均为 false，导入循环不重新检查，第二个覆盖第一个。

**修复方向**: 导入前按 `destName` 分组，同名冲突时提示用户或按优先级排序。

---

### F5: Slim "恢复完整插件" 不清除粘性跳过模式

**文件**: `src/launcher/launcher-service.js:515-522`；`src/main/index.js:1388-1395`  
**影响**: slim 模式下 `retryFullPlugins()` 仅启动外部桌面端，不清除持久化的跳过标记，导致恢复完整插件的操作实际仍以跳过模式启动。

**修复方向**: slim 恢复完整插件时清除 sticky recovery 标记，或显式传递 `--no-skip-user-plugins`。

---

### F6: 安装程序完成未绑定到请求版本

**文件**: `src/launcher/runtime-install.js:105-164`  
**影响**: `waitForInstall` 的 `reinstallSettled` 条件在子进程退出且注册表存在时即接受，即使版本未变。取消或失败的安装可能错误报告 `status: 'installed'`。

**修复方向**: 要求观察到的版本与请求目标匹配，或区分"修复完成"与"版本变更"。

---

### F7: 附件失败不使导入不成功

**文件**: `src/main/data-import.js:1351-1379,1742-1753`  
**影响**: 附件复制异常转为 `failed:...` 字符串，但 `importSessions().ok` 仅检查会话行失败。会话成功+附件失败仍返回 `ok:true`。

**修复方向**: 附件失败应计入整体结果，或至少标记为部分成功。

---

### F8: 被拒绝的导入 IPC 调用无终端错误诊断

**文件**: `src/renderer/launcher.js:1440-1479,2078-2118`  
**影响**: 导入按钮处理器有 `try/finally` 但无 `catch`，IPC 拒绝后按钮恢复但结果文本仍显示"正在导入…"；摘要计数省略失败详情。

**修复方向**: 添加 `catch` 显示错误信息；摘要包含失败计数和项目级错误。

---

### F9: 确认对话框和路由弹出背景引用不存在的 token

**文件**: `src/renderer/launcher.css:295,1185`；`src/shared/dsh-webui-tokens.css`  
**影响**: `--dsw-alias-layer-fill-2` 未在 token 表中定义，导致确认对话框和路由弹出背景声明失效，可能渲染为透明或错误颜色。

**修复方向**: 改用已定义的 `--dsw-alias-bg-layer-2` 或补充 token 定义。

---

### F10: 标签/单选语义和键盘状态不完整

**文件**: `src/renderer/launcher.html:25-49,199-211,251-255`；`src/renderer/launcher.js:147-158,660-692`  
**影响**: 主导航和导入类别使用 `role="tab"` 但缺少 roving focus 和方向键处理；设置页 `radiogroup` 按钮无 `radio` 角色和 `checked` 状态；导入进度缺少 live-region 语义。

**修复方向**: 添加键盘导航支持；为单选组添加正确 ARIA 角色；为进度/结果添加 `aria-live`。

---

## UI/排版审查结果

### 字体大小合规性

| 元素 | 实际 | 规范 | 状态 |
|------|------|------|------|
| `.page-head h2` | 16/24 | 标题 16/24 | ✅ 符合 |
| `.lede`, `.meta` | 14/22 | 正文 14/22 | ✅ 符合 |
| `.import-summary` | 12/18 | 紧凑 12/18 | ✅ 符合 |
| `.import-foot-opts`, `.import-foot-run` | 16/normal | 应继承或显式设置 | ⚠️ 继承 body 16px，与内部 12px 文本不一致 |
| `.import-scope-detail summary` | 16/normal | 应 12/18 或 14/22 | ❌ 过大 |
| `.line-chip`, `.line-chip-btn` | 16/normal | 应 12/18 | ❌ 过大 |
| `.import-toolbar` | 16/normal | 应 12/18 | ❌ 过大 |

### 布局问题

1. **导入页底部栏拥挤**（1060×660 视口）：
   - `.import-foot` 高度 45px，但内部元素字体大小不一致（16px vs 12px）
   - "已选..." 摘要文本 max-width 280px 导致换行后挤压按钮空间
   - `.import-foot` 的 `flex-wrap: wrap` 在窄视口下导致换行，但无最小高度保护

2. **导入列表项显示问题**：
   - `.import-item` 的 `padding-left: 28px` 与 `.import-cluster` 的缩进不一致
   - 长会话标题/元数据可能溢出（无 `text-overflow: ellipsis`）

3. **线路选择器**：
   - 左下角"线路 未选择"使用 16px 字体，比周围文本大，视觉突兀

### 可访问性问题

- 导入进度/结果缺少 `aria-live` 区域
- 主导航和导入类别缺少键盘方向键导航
- 设置页单选组缺少 `radio` 角色和 `checked` 状态
- 确认对话框缺少 `role="dialog"` 和焦点陷阱（已确认有初始焦点和 Escape，但缺少 Tab 循环）

---

## 测试覆盖

- **现有测试**: 238 个测试通过，0 失败（`node --test src/main/*.test.js src/renderer/*.test.js`）
- **隔离复现**: 4 个确定性故障注入测试（附件替换、崩溃恢复、MCP 合并、附件失败）
- **UI 验证**: 6 页面 × 2 视口（1280×720, 1060×660）截图 + 计算样式检查

---

## 建议修复优先级

1. **立即修复（P1）**：附件导入 overwrite 尊重、崩溃安全、运行时静止
2. **短期修复（P2）**：同名技能冲突、slim 恢复、安装版本绑定、附件失败状态、IPC 错误处理、token 修复、可访问性
3. **UI 优化**：统一导入页字体大小、修复底部栏布局、线路选择器样式

---

## 审查限制

- 基于当前脏工作树，未测试干净 HEAD
- 未测试真实 Windows 安装程序行为
- 未测试高 DPI/缩放场景
- 部分 UI 问题需设计规范确认是否为有意为之


## ChatGPT 独立审查状态

已发送 EXECUTED 请求，ChatGPT 正在独立复核证据和代码。当前状态：审查中。

