# Decision: 启动器更新确认与导入任务归属

Status: implemented

中文 | [English](2026-09-24-launcher-update-import-ownership.en.md)

## Problem

冷启动提示版本 A 后，安装操作再次读取 `/releases/latest`，可能转而安装版本 B。可见启动器在确认框期间关闭时，更新结果已从内存队列取走，却没有重新入队。自动启动返回 `{ok:false}` 仍被冷启动闸门报告为桌面成功。两个并发导入请求会覆盖同一个取消控制器并写同一个 journal；空选择也会创建完成 journal。

## Decision

更新确认传递同一份 release 快照给安装路径；该路径不再重复查询 latest，也不调用指向可变 `latest.yml` 的 updater 通道，而是下载快照指定的完整 Setup 并沿用 SHA512 校验。窗口代际失效造成的放弃将更新结果重新停放；自动启动失败时闸门报告启动器结果，已显示的启动器消费迟到更新。主进程在停止内核之前就占用导入任务锁，第二个请求返回 `import-in-progress`，完成或异常均释放锁。空选择保留结果和进度事件，但不写 journal。

## Alternatives considered

- **确认后再查 latest 并比较版本号**：同一 tag 的资产仍可能变化；第二次网络失败也会让已确认的操作改变结果。
- **继续用 updater 的 latest.yml**：其目标由远端最新元数据决定，不能保证与确认框看到的 release 相同。独立增量包在后续发布链中另行实现。
- **只禁用导入页按钮**：IPC 可并发调用，且窗口刷新或另一调用方仍可能覆盖取消目标；互斥必须在主进程。

## Consequences

冷启动确认路径暂走完整包下载，直到有可绑定目标版本的增量发布清单。导入空选择不留下 journal。定向测试覆盖窗口中途关闭、版本快照传递、启动失败后的迟到更新、并发导入及异常后重试。
