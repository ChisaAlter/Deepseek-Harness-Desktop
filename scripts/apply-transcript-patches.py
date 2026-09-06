#!/usr/bin/env python3
"""Apply StrReplace ops from transcript onto existing workspace files."""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TRANSCRIPT = Path(
    r"C:\Users\48818\.cursor\projects\c-Ai-Deepseek-Harness-Desktop\agent-transcripts"
    r"\81c82e85-2055-4a01-8e78-581dfd5b6d44\81c82e85-2055-4a01-8e78-581dfd5b6d44.jsonl"
)

TARGETS = [
    "src/main/config.js",
    "src/main/config.test.js",
    "src/main/index.js",
    "src/shared/lan.js",
    "mobile/web/app.js",
    "mobile/android/app/src/main/java/ai/deepseek/harness/mobile/DshViewModel.kt",
    "vendor/deepseek-harness/packages/client/ui-settings-remote/src/client/RemoteSection.tsx",
    "src/main/dshd-remote.js",
    "mobile/web/chisacode/session.js",
    "mobile/web/chisacode/session.test.js",
    "src/main/dshd-remote.test.js",
    "docs/features/mobile-remote.md",
]


def norm_rel(raw: str) -> str | None:
    raw = raw.replace("\\", "/")
    m = re.search(r"Deepseek-Harness-Desktop/(.+)$", raw, re.I)
    if not m:
        return None
    rel = m.group(1)
    for t in TARGETS:
        if rel.lower() == t.lower():
            return t
    return None


def main() -> None:
    patches = {t: [] for t in TARGETS}
    with TRANSCRIPT.open(encoding="utf-8") as f:
        for line in f:
            obj = json.loads(line)
            for part in obj.get("message", {}).get("content", []):
                if part.get("type") != "tool_use" or part.get("name") != "StrReplace":
                    continue
                inp = part.get("input", {})
                rel = norm_rel(inp.get("path", ""))
                if not rel:
                    continue
                patches[rel].append((inp.get("old_string", ""), inp.get("new_string", "")))

    for rel in TARGETS:
        path = ROOT / Path(rel)
        if not path.exists():
            print("skip missing", rel)
            continue
        text = path.read_text(encoding="utf-8")
        applied = 0
        for old, new in patches[rel]:
            if not old:
                continue
            if old in text:
                text = text.replace(old, new, 1)
                applied += 1
        path.write_text(text, encoding="utf-8", newline="\n")
        print(f"{rel}: {applied}/{len(patches[rel])} patches applied")


if __name__ == "__main__":
    main()
