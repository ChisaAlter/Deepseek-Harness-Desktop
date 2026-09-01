# §15 / §16 · 已装 exe 全套（HEAD 本机 Setup）

**Setup SHA256:** `49BD62B56D47FE0AD312B9E4C684D3070AFF81D6086595F55C80FB28C403FECA`  
**路径:** `%LOCALAPPDATA%\Programs\Deepseek-Harness-Desktop\`  
**证据:** `install-full-report.json` / `install-full-log.txt`  
**版本:** 0.2.7（未升版、未打 tag、未 `gh release create`）  
**bundled node:** 本机 pack 写入 `v24.15.0`（CI Node 22 才会是 v22）

## §15 走表

`run-installed-full.mjs` **`pass: true`**（exit 0）。

| 套件 | 结果 |
| --- | --- |
| release | ok；`files.mentionAppended`=`[note.md](note.md)`；`titlebar.sessionLog`=Session 日志；`git.commit`=`qa: commit note.md 1788206709410`；`market.discover`/`installed`；`models.visionPicker` |
| composer official | ok（Lexical mention / preview / `$fo` / `@` / terminal） |
| appendix | ok：五轮 + editUser + **reject**（点了拒绝，探测文件未落地）+ vision（不支持图片 toast） |
| remote | parked ok |
| shell | ok |
| packagedP0 | Ghostty wasm **HTTP 200** |

## §16 结论

本机 HEAD Setup 上，此前卡住的 P0 Fail（wasm、Lexical、Session 日志、Git 唯一 subject、mention、市场发现、识图、附录 README、reject、vision）均已在已装 exe 上绿。

**不要勾「Release 将上传同一 SHA」**，直到 `workflow_dispatch` 打出同一棵树的 CI 包并再跑一遍（CI node 必须是 v22）。
