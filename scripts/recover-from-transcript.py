#!/usr/bin/env python3
"""Replay Write/StrReplace tool ops from agent transcript onto workspace."""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TRANSCRIPT = Path(
    r"C:\Users\48818\.cursor\projects\c-Ai-Deepseek-Harness-Desktop\agent-transcripts"
    r"\81c82e85-2055-4a01-8e78-581dfd5b6d44\81c82e85-2055-4a01-8e78-581dfd5b6d44.jsonl"
)

# Only recover pairing-related paths (avoid overwriting unrelated work).
ALLOW = re.compile(
    r"(dshd-remote|chisacode-remote|mobile-web-server|mobile/web/chisacode|mobile/web/app\.js|"
    r"mobile/web/pair/scan|shared/lan\.js|shared/lan\.test|config\.js|config\.test|"
    r"dshd-remote\.test|session\.js|session\.test|DshViewModel\.kt|"
    r"RemoteSection\.tsx|locales\.ts|mobile-remote\.md|remote-settings\.md|"
    r"_kill-http-remote|prestart-ensure|bundle-chisacode|link-chisacode|defaults\.json)",
    re.I,
)


def norm_path(raw: str) -> Path | None:
    raw = raw.replace("\\", "/")
    m = re.search(r"Deepseek-Harness-Desktop/(.+)$", raw, re.I)
    if not m:
        return None
    rel = m.group(1)
    if not ALLOW.search(rel):
        return None
    return ROOT / rel.replace("/", "\\")


def main() -> int:
    if not TRANSCRIPT.exists():
        print("transcript missing", file=sys.stderr)
        return 1
    files: dict[str, str] = {}
    with TRANSCRIPT.open(encoding="utf-8") as f:
        for line in f:
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                continue
            for part in obj.get("message", {}).get("content", []):
                if part.get("type") != "tool_use":
                    continue
                name = part.get("name")
                inp = part.get("input", {})
                p = norm_path(inp.get("path", ""))
                if not p:
                    continue
                key = str(p)
                if name == "Write":
                    files[key] = inp.get("contents", "")
                elif name == "StrReplace":
                    old = inp.get("old_string", "")
                    new = inp.get("new_string", "")
                    if key not in files:
                        continue
                    if old in files[key]:
                        files[key] = files[key].replace(old, new, 1)
    written = 0
    for key, content in files.items():
        path = Path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8", newline="\n")
        print("wrote", path.relative_to(ROOT))
        written += 1
    print(f"done: {written} files")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
