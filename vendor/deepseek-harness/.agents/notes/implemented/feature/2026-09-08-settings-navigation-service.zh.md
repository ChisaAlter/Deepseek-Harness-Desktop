# Agent Note: Client Settings 导航服务

Status: implemented

[English](2026-09-08-settings-navigation-service.md) | 中文

## 问题

Settings 外壳的可见状态与请求分区是组件本地状态，普通客户端插件无法在已注册分区上打开既有 modal，也无法在外壳挂载前发出请求。

## 决策

`ui-settings-general` 提供类型化的 `ctx.settingsNavigation` 客户端服务。它的 `open(sectionId?)` 与 `close()` 方法发布一份可观察快照，其中包含外壳可见状态与请求分区 id。`SettingsRoot` 通过注入的 hook source 消费同一份快照，并让触发器、导航、onboarding、遮罩、Escape 与标题栏关闭路径都经由服务回调。

服务保存请求 id，但不针对 ledger 做校验。`SettingsRoot` 根据当前 `settings.section` 投影解析请求 id，因此省略、空值和未知 id 都会沿用既有外壳，并打开当前注册的首个分区。服务在 `apply` 中创建，生命周期跟随包 fiber；重载会创建新实例，不保留旧外壳状态。

`/client` 入口只导出 `SettingsNavigation` 与 `SettingsNavigationSnapshot` 类型，实作类保持内部。Context 声明与运行时 provider 都位于 `ui-settings-general`，因此 `ui-settings` 不会获得呈现依赖或新的值依赖边。

## 备选方案

**暴露 React setter 或模拟侧边栏点击。** 否决，因为两者都绕过可观察状态所有权，无法覆盖挂载前请求，并把插件耦合到组件或 DOM 细节。

**把服务放进 `ui-settings`。** 否决，因为 `ui-settings` 拥有设置传输与 slot 类型但不渲染外壳；把导航放在那里会让底座包持有呈现状态，并扩大超出外壳所有者的修改范围。

**在服务内部校验分区 id。** 否决，因为服务不拥有实时 section ledger 的稳定读取边界。由外壳根据当前投影解析，可以在注册关系变化时继续提供首项回退。

## 后果

普通客户端插件可以打开既有 Settings modal，不会产生第二套界面；外壳挂载前发出的请求会在它出现时被消费。重复 open 请求会在 modal 保持挂载时切换呈现分区。所有关闭路径发布同一个关闭服务状态，既有 presence、焦点恢复、onboarding、触发器与分区 ledger 行为仍由外壳持有。

需要编译期访问的消费者导入公共服务类型；运行时协作使用 Cordis service 注入。该可观察服务是进程内的界面查看状态，不持久化，也不写入 session log。

## 测试

导航 focused Settings suite 在四个文件中通过 40 项测试，`ui-settings-general` 包全量 suite 在 12 个文件中通过 72 项测试。`ui-settings-general` TypeScript 项目通过 `tsc --noEmit`。README 中英文配对记录已更新。
