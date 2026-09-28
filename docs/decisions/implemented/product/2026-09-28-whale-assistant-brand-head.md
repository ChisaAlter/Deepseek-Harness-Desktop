# Decision: 鲸鱼娘助理统一使用项目头像

Status: implemented

中文 | [English](2026-09-28-whale-assistant-brand-head.en.md)

## Problem

鲸鱼娘助理的身份标记散落在多处：常驻会话标题在配置名前拼 `🐳`，侧栏面板使用 `IconSparkle16`，助理页空态与桌宠快捷对话卡也各用 emoji。它们都不等于应用侧栏使用的项目头像 `assets/whale-head.png`，因此用户看到的是一组相似的“普通鲸鱼”而不是鲸岛品牌。

宿主把 `presentation.title` 当纯文本渲染，不能直接塞入图片。若继续在标题里放 emoji，只能换成一个仍非项目 logo 的字符；若把标题改为 Markdown 或 HTML，则会污染会话名的语义、复制文本和搜索。

## Decision

- 常驻会话的 `presentation.title` 只保存配置名（空名回退“鲸鱼娘”），不再包含任何 emoji 前缀。
- 客户端在 `conversation.session.header.leading` 注册 16px 项目头像，仅当当前会话 `presentation.owner === 'dsh-whale:assistant'` 时渲染；标题仍由宿主的标准 breadcrumb 输出，普通会话完全不受影响。
- 侧栏 `sidebar.panellist`、底栏回退入口、助理空态都改用同一项目头像；桌宠快捷对话卡也以图片头像取代 `🐳`。
- Web 壳与桌宠分别使用同源资产：Web 读 `/whale-isle-head.png`（与 `assets/whale-head.png` 字节一致），桌宠经现有 `pet://pet/pet-head.png` 固定映射读取 `assets/whale-head.png`。
- 头像按 `object-fit: contain` 等比显示，不使用方形底板、不拉伸。`pet://` 映射是固定文件名，不放宽任何任意路径读取，路径穿越校验保持原样。

## Alternatives considered

- 把 `presentation.title` 改成 `![鲸鱼娘](...)` 或内嵌图片 URL：会话名会被 Markdown 语法污染，复制、搜索和通知都会带上非名称文本。
- 只把 `🐳` 换成 `🐋`/`🐬`：操作最小，但仍不是项目 logo，继续制造第二套身份符号。
- 在会话头尾额外注册一个图片 action：实现可行，但会占用“动作”语义；这个标记是标题身份的一部分，`header.leading` 更合适。
- 让桌宠协议直接访问任意 `assets/**`：扩大协议权限面；固定 `pet-head.png` 别名已满足需求且保持白名单边界。

## Consequences

鲸鱼娘在侧栏、会话标题栏、助理空态与桌宠快捷卡上共享同一个鲸岛头像，标题文本保持纯名称。`header.leading` 是 single slot，本插件按会话身份门控占用；其他普通会话渲染 `null`，不改变其标题结构。新增 `dsh-whale-client` 契约测试覆盖头像源、尺寸与 owner 门控；`desktop-live2d` 协议测试覆盖固定品牌映射及穿越拒绝。定向测试 57/57。
