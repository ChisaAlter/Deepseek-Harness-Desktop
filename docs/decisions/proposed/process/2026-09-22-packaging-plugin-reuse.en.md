# Decision: Packaging reuses a verified plugin dependency tree

Status: proposed

[中文](2026-09-22-packaging-plugin-reuse.md) | English

## Problem

When `scripts/after-pack.js` prepares runtime dependencies for built-in plugins, `dsh-im` takes an
unconditional reinstall path:

```
restoreVendoredPluginNodeModules(projectDir, resources, 'dsh-im');
installPluginRuntimeDeps(path.join(resources, 'vendor', 'dsh-im'), { skipIfComplete: false });
```

`defaultNpmInstall()` first removes `node_modules` recursively, then runs `npm ci` or `npm install`
synchronously. The dependency tree that the previous step had just restored from the vendor tree is
deleted and reinstalled on every pack.

The "reinstall rather than risk it" choice had a real cause: the completeness check at the time walked
only a limited number of nested dependency levels, so a tree missing a grandchild dependency's entry
file was reported complete and only failed at runtime, in Settings → Remote → Channels. The problem is
that "guard against a half-broken tree" was implemented as "always reinstall", charging a healthy tree
the same price as a broken one.

## Proposal

Let a real dependency closure over actual resolution sites decide reuse, instead of the "force
install" switch:

- `plugin-runtime-files.js` adds `auditRuntimeClosure(packageDir, { resolveRoot, maxPackages })`: a BFS
  over Node's **actual resolution sites**, not a recursive directory walk by depth. Visited and queued
  sets are canonicalized through realpath, so a package referenced by several parents is visited once
  and cycles and symlink loops terminate naturally.
- `missingPluginRuntimeClosure()` calls that audit and `DEFAULT_CLOSURE_DEPTH` is deleted. The
  traversal budget defaults to 20000 packages; exhausting it returns `<closure-incomplete>` and counts
  as **incomplete** (fail closed) rather than reporting completeness because the walk did not finish.
- The default verifier of `installPluginRuntimeDeps()` is that closure, and it re-runs the **same**
  verifier after the install command returns successfully; an install that exits 0 without repairing
  the closure throws, so no "detect deep gap → install → shallow check passes" path remains.
- `restoreVendoredPluginNodeModules()` checks before and after the copy and returns unresolved entries
  as `unresolved`; `assertVendoredPluginRuntimeDeps()` uses the same closure, so assembly no longer has
  two predicates of different depth.
- `skipIfComplete` keeps its original meaning (a shallow check passing skips the install), so no other
  caller changes behaviour.

This makes "healthy tree, zero reinstall" and "broken tree, must repair" hold at once: the predicate
becomes a real closure and the action becomes lighter.

## Alternatives considered

- **Just flip `skipIfComplete` to `true`** — rejected: the shallow predicate is exactly what let a
  half-broken tree through. That trades a looser check for fewer installs, lowering correctness with
  nothing in return.
- **Only deepen the default `depth` of `missingRuntimeFiles()`** — rejected (implemented, then
  overturned): that function is called from `dsh-im-desktop.js`, `dsh-remote-desktop.js`,
  `dsh-whale-desktop.js` and `dshbot-desktop.js`, so changing its default would also change the cost
  and semantics of the startup fail-closed checks; and a deeper depth is **not a closure** — anything
  beyond it still slips through. This adds a separate traversal over real resolution sites instead.
- **Cache the install result by mtime or install timestamp** — rejected: a timestamp cannot detect a
  deleted entry file, which is the same failure mode as before. Completeness has to be checked for
  real every time; the check merely has to be cheap and complete enough.
- **Validate only the vendor source tree at pack time, not the assembled destination** — rejected:
  assembly itself drops files (that is why `restoreVendoredPluginNodeModules` exists), so the
  decision has to be made on the real destination tree.
- **Treat an install command's exit code 0 as repaired** — rejected (implemented, then overturned): a
  zero exit only means the command did not fail, not that the destination closure is complete. The
  same verifier must re-run after the install.

## Acceptance criteria

- `node --test src/main/after-pack.test.js`: a healthy tree returns `verified-complete` and never
  calls the installer; the grandchild negative case ("dependency directory present, declared entry
  file missing") still triggers the install.
- Missing dependencies more than three levels deep, cycles, symlink loops, and an exhausted traversal
  budget (reported incomplete, not complete) each have a case; an install callback that returns
  successfully without repairing anything must throw.
- On the reuse path, `dsh-im` no longer spawns `npm` when its dependencies are complete, and the
  packaged plugin still passes `assertVendoredPluginRuntimeDeps`.

## Risks

- The closure check has a **package-count budget** (20000 by default), not a depth limit; an exhausted
  budget is incomplete and fails closed, so an oversized tree costs a fallback install instead of a
  missed gap being waved through.
- Reusing a dependency tree means reusing the `node_modules` already present in the vendor tree, which
  may contain native modules that do not match the target platform or ABI. The current `dsh-im`
  dependencies are pure JavaScript (Tencent connectors, dingtalk-stream, qrcode); introducing a native
  dependency requires folding platform and ABI into the decision before reuse is allowed.
- The check adds one deeper directory walk at pack time. That is negligible next to a full `npm ci`,
  but the reuse path is no longer free.
