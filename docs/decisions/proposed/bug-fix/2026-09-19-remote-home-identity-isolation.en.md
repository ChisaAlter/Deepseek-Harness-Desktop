# Decision: Remote CLI identity files fall back to an absolute home

Status: proposed

[中文](2026-09-19-remote-home-identity-isolation.md) | English

## Problem

`packages/cli/src/utils/client-id.ts` computes its session identity path with `process.env.CHISACODE_HOME ?? join(homedir(), ".chisacode")`. The `??` operator treats only `null` / `undefined` as absent, so `CHISACODE_HOME=''` writes `cli-client-id` to the current working directory; an absolute-looking relative value still binds identity state to the process cwd, giving the same environment different identities in different directories. This repository already has an untracked root `cli-client-id`, proving that the path can write into the checkout.

## Proposal

Extract home resolution into the exported pure helper `resolveCliClientIdDirectory(env)`, called lazily every time the identity file is read or created. After `trim()`, an empty `CHISACODE_HOME` or a non-absolute path falls back to `join(homedir(), ".chisacode")`; a syntactically valid absolute path is preserved as-is without normalization or content restrictions. Keep the public `getOrCreateCliClientId()` API and caching semantics unchanged. Add `/cli-client-id` to the root `.gitignore` as defense in depth, so an accidental write does not pollute the workspace again.

## Alternatives considered

- **Only change `??` to `||`** — rejected: an empty value would fall back, but a relative path would still bind identity state to the process cwd, violating the "never write checkout/CWD" requirement.
- **Call `@chisacode/server`'s `resolveChisaCodeHome()` uniformly** — rejected: that function immediately creates and tightens directory permissions, while the CLI identity module only needs path resolution; handling blank and relative values locally is smaller and easier to test.
- **Cache a constant path at import time** — rejected: it prevents tests from injecting an environment and makes reads and writes share a stale path; YAGNI.

## Acceptance criteria

`packages/cli/src/utils/client-id.test.ts` covers unset / empty / whitespace-only / relative / absolute inputs, asserting that all but the last resolve to `join(homedir(), ".chisacode")` while the absolute value is returned unchanged. Two additional write cases point `HOME` / `USERPROFILE` at a temp directory: an absolute `CHISACODE_HOME` receives the identity file and a fresh module instance reuses the same identity, while blank and relative values both write under the `~/.chisacode` fallback. These cases never read or write the real user profile and leave no identity file inside the checkout. The pre-existing untracked root `cli-client-id` is neither deleted, moved, nor added to version control.

## Risks

An absolute path is still used exactly as supplied, so if that path itself points into the repository the CLI will still write identity there; this decision only rejects empty and relative values. On Windows, "absolute" follows `node:path.isAbsolute` (drive letter or UNC), so a leading `~` is treated as a relative path and falls back, differing from the current token-expansion behavior.
