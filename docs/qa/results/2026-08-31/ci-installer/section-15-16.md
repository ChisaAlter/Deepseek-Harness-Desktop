# §15 / §16 · 已装 exe 全套（CI Node 22 Setup）

**Setup SHA256:** `F2C571D285B68E730FEFF5E8FB1362F48484761278D939D84E2BFD1298562856`  
**Actions:** https://github.com/ChisaAlter/Deepseek-Harness-Desktop/actions/runs/33455954068  
**树:** `cc430e856207129dfe2eebf0549492bd4bd6efa5`  
**路径:** `%LOCALAPPDATA%\Programs\Deepseek-Harness-Desktop\`  
**证据:** `install-full-report.json` / `install-full-log.txt` / `persist-sessions-zstd.json` / `install-tray-quit-report.json` / `silent-install-report.json`  
**版本:** 0.2.7（未升版、未打 tag、未 `gh release create`）  
**bundled node:** **v22.22.2**

## §15 走表

`run-installed-full.mjs` 第一轮 **exit 0**。persist 打包 walker 只数 `session.jsonl`（0），host 数到 **85** 个 `session.jsonl.zstd` 后 `pass: true`。

| 套件 | 结果 |
| --- | --- |
| release | ok；`composer.thinkingSwitch`=`switched Low → Default`；`files.mentionAppended`=`[note.md](note.md)`；`titlebar.sessionLog`=Session 日志；`git.commit`=`qa: commit note.md 1788227705576`；`market.discover`/`installed`；`models.visionPicker` |
| composer official | ok；`case.terminal.addToChat` 终端 fence |
| appendix | ok：五轮 + editUser + reject（探测文件未落地）+ vision |
| remote | parked ok |
| shell | ok |
| packagedP0 | Ghostty wasm **HTTP 200** |
| persist | packed `persist.sessions` Fail；host override **zstd=85**；theme midnight / workspace / grok-4.6 Default / wallpaper / closeToTray Pass |
| tray-quit | **pass**；`exit.code=0`；进程 0 |

## §16 结论

空 P0（MODEL-004 / SESS-003 / TERM-002 / NEG-005）已在该 SHA 填 Pass。  
已勾「Release 将上传同一 SHA」。造障项仍 Blocked。产品负责人未签。
