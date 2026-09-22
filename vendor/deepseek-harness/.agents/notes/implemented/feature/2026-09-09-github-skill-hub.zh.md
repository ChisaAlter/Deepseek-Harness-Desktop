# Agent Note: GitHub 技能枢纽

Status: implemented

[English](2026-09-09-github-skill-hub.md) | 中文

## 问题

Skills Settings 只列出、编辑和启停磁盘上已有的技能，要找一个公开技能就得离开应用去浏览 GitHub 并手工复制目录。内置目录需要自己的评审与刷新流程，只做界面层的市场则装不上任何真实产物。

## 决策

既有 Skills Settings 分区通过官方 GitHub CLI 搜索并安装公开 Agent Skills，安装复用分层技能库，不另建第二套技能存储。

- 搜索使用 \`skillInventory.searchHub\`，数据来自有界且结构化的 \`gh skill search\` 输出。
- 安装经 \`skillInventory.installHub\` 固定仓库当前默认分支的 HEAD SHA，并使用搜索结果中精确的仓库与路径；旧的 release tag 无法让一次搜索命中失效。
- 目标目录是 \`$DSH_HOME/skills\` 或最近项目根目录的 \`.dsh/skills\`。
- 确认视图在执行前给出来源与目标。
- 既有技能不会被静默覆盖；Host 不传 \`--force\`。
- GitHub CLI 缺失或版本不足、以及安装冲突，都返回仍然打开的 modal。
- 安装成功后使既有分层技能注册表失效并刷新。

输入在进程启动前完成校验和有界限制，子进程输出与运行时长同样有界，因此桥接层不会退回未经校验的下载器。

## 备选方案

**内置或托管一份技能目录。** 否决，因为精选索引需要自己的评审与刷新流程，而确认视图本来就必须给出真实仓库与路径。

**沿用 \`gh skill install\` 的默认版本解析。** 否决，因为它优先选择旧的 release tag，新搜索命中的技能可能装成与用户确认时不同的版本。

**直接调用 GitHub REST 或 raw content 接口搜索与下载。** 否决，因为认证、速率限制和隐藏目录处理都要在已经拥有这些能力的 CLI 旁边再实现一遍。

**只安装到用户级 \`$DSH_HOME/skills\`。** 否决，因为自行固定技能的项目会拿到一份不属于它的副本；目标目录跟随用户选择的作用域。

## 后果

安装始终绑定公开 GitHub 仓库，桌面端不携带自己的目录。\`gh\` 缺失或版本过旧时，modal 内给出可操作的错误，而不是静默无操作或未经校验的下载。所选作用域已存在同名技能时安装被阻止而不是替换，也不存在可绕过的 \`--force\` 路径。

项目作用域的安装写入工作树，因此同名技能可以同时存在于两个作用域，由既有分层注册表解析。

## 测试

- Host gateway 与 GitHub CLI 桥接单元测试覆盖搜索解析、HEAD 固定和安装校验。
- Skills Settings 浏览器测试覆盖搜索、确认、用户/项目作用域、成功刷新与失败保留。
- Host 与 client TypeScript 包检查。
