# 流程：添加 SSH 远程工作区

## 前置条件

- 桌面 Harness 可正常启动，且通用 → 界面设置中的「远程工作区（SSH）」处于开启状态。
- 已获准使用一个 SSH 测试机器。首次连接核对主机指纹；生产验收不得连接未经授权的主机。

## 步骤

1. 打开设置 →「远程工作区」（`remote-workspace`），添加机器并填写连接方式、用户、端口和凭据。按需配置跳板机、OTP 与主机密钥策略。
2. 对刚保存的机器执行「测试连接」。连接成功后可设为当前机器；认证、网络、主机指纹或超时错误应能区分。
3. 从「添加工作区」打开「远程」tab，选择机器并浏览远端目录。需要时在选定位置创建目录，再选择目标文件夹。
4. picker 为所选远端目录准备桌面本地镜像，并把镜像路径加入工作区列表。确认桌面工作区在 `$DSH_HOME/remote-workspaces/<host>-<user>-<port>/<basename>` 下；本机 tab 继续使用原有页内目录浏览。
5. 在该工作区开会话，确认 cwd 位于镜像中，远程上下文与适用的 `rw_*` 工具可用。写入一份临时文件后检查远端内容和 audit log。
6. 在右侧「远程文件」tab 打开远端文件。若远端文件在编辑期间被另一端修改，保存应检测 mtime 冲突并要求重读；不得静默覆盖。
7. 在「远程工作区」设置检查转发与最近审计。启用一个仅供验收的 local forward 后确认本机监听限定在 `127.0.0.1`，再停止并移除它。
8. 到通用 → 界面设置关闭 SSH 远程工作区。Harness 重启后远程插件不再挂载，而本机目录 picker 仍能工作；重新打开开关后 Harness 再重启，远程入口恢复。

## 失败与数据边界

- 已信任的主机若更换 key，连接必须拒绝；`verify` 策略不得自动信任未知 key。
- `rw_sync` / `rw_push` 遇到本地、镜像和远端三方冲突时报告冲突，不得静默覆盖。验收不要用 `force=true` 绕过冲突。
- 凭据只通过安全通道输入。截图、终端记录和验收报告不得包含密码、私钥、token 或完整连接 URI。
- 运行 API 级用例时，每轮使用独立临时 HOME 和远端 fixture 目录；必须确认 teardown 已删除临时对象。脚本缺配置时输出 `NOT RUN (not PASS)`，不能记作 Pass。

## 门槛

- 手动用例：[`production-acceptance-test-cases.md` 的 TC-RW-*](../../qa/production-acceptance-test-cases.md)。必须在表中记录实际 CI artifact SHA 和证据。
- 自动化 live runner：[`scripts/verify-remote-workspace-live.cjs`](../../../scripts/verify-remote-workspace-live.cjs)；缺少 SSH fixture 时为 NOT RUN。
- 契约：[remote-workspace Feature 卡](../../features/remote-workspace.md)。
