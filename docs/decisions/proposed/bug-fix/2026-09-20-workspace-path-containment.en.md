# Decision: Workspace path containment is decided per segment, and `.git` is judged on the resolved path

Status: proposed

[中文](2026-09-20-workspace-path-containment.md) | English

## Problem

The desktop workspace decides whether a path is inside an authorized root by prefix-testing the
result of `path.relative()`, written in several places as `rel.startsWith('..')`. That test
conflates two completely different classes of input:

- **Actual traversal**: for `..`, `../outside.txt`, and `sub/../../outside.txt`,
  `path.relative()` returns `..` or `..\\…`.
- **Ordinary names**: for `..notes`, `sub/..cache`, and `..dir/inner.txt`, which really exist in
  the workspace, `path.relative()` likewise returns a string beginning with `..`.

As a result, `resolveInside` (`src/main/workspace-authority.js`), `containedIn`, and
`resolveGitPath` (`src/main/git.js`) misclassify legitimate names as escaping the workspace:
Files cannot open them, files cannot be staged, and Git path operations report `Path is outside
the workspace.`. This is a **usability defect**, not a security issue — the rejection itself is
fail-closed. The same pattern also appears in `src/main/preview.js`,
`src/main/data-import.js`, `tools/mobile-web-qa/server.mjs`, and `scripts/after-pack.js`.

The second defect runs in the opposite direction and is a **real privilege escalation**. The
`.git` protection performs segment matching only on the **incoming path string**: `writeFile`
rejects any path containing a `.git` segment, and `listDir` hides `.git`. But a **link with an
innocuous name** in the workspace (for example, a directory junction named `notes` that points
to `.git`) has no `.git` segment in the request, and `resolveInside` only verifies that “the
realpath is still inside the root” — a link that points to the in-root `.git` is judged to be
inside the root — so the check passes. In a reproduction,
`workspaceFs.writeFile(cwd, 'notes/hooks/pre-commit', 'EVIL')` returned `{ ok: true }`, and
`.git/hooks/pre-commit` was overwritten. Hooks in repository metadata execute on the next Git
invocation, so this is a path from “saving a file” to “executing code.” `listDir`/`readFile`
can likewise read `.git` contents through that link.

Third, `resolveInside` returns a **lexical** target, and callers perform the privileged
operation only after the check. The `writeFile` in `workspace-fs.js` has a check-use gap
between `resolveInside` and `mkdir`/`writeFile`: if the target directory is replaced with a
link to `.git` at the moment `mkdir` is called, the write still lands successfully inside
`.git` (reproduced with a deterministic interleaving: patch `fs.promises.mkdir` so that on its
first invocation it replaces `victim` with a junction from `victim` to `.git`, then assert that
the save must fail and the sentinel bytes remain unchanged — the assertion failed before the
fix).

All three problems share the same root cause: **containment and `.git` decisions both use only
string prefix/segment matching rather than the resolved real path**, and an unrechecked time
window remains between the decision and the privileged effect.

The fourth and fifth gaps are two **reverse bypasses that the fixes above did not cover**, each
reproduced with a counterexample during review:

- **A caller-selected cwd can launder `.git`**: the `.git` rule only looked at the path
  *relative to the incoming cwd*. `resolveAuthorizedCwd` accepts any real subdirectory of an
  authorized root, so `writeFile(<root>/.git, 'hooks/pre-commit')` produces the relative path
  `hooks/pre-commit`, which contains no `.git` segment; the same holds for `<root>/.git/hooks`
  and for a link whose innocuous name resolves into `.git`. All three forms returned
  `{ ok: true }` and rewrote `.git/hooks/pre-commit`.
- **A dangling link was mistaken for “a path that has not been created yet”**: `resolveInside`
  walks upward when realpath fails, but realpath also fails for a **dangling link**. Requesting
  `note-link` (where `note-link` points at a file that **does not yet exist** outside the root)
  made the whole chain look absent, `writeFile` validated only the parent, and the write created
  the out-of-root file. `canonicalInside` had the same fallback. The out-of-root `new-file.txt`
  was created in a reproduction.

Both gaps share one root cause: **the `.git` rule was not anchored to the trusted root, and a
failed realpath did not distinguish “genuinely absent” from “present but unresolvable.”**

## Proposal

Consolidate two single sources of truth in `workspace-authority.js`, reused by each caller:

1. `escapesBase(fromBase)` treats only an “absolute path”, a path exactly equal to `..`, or a
   path beginning with `..` plus a separator as an escape, replacing `startsWith('..')`; both
   `containedIn` and `resolveInside` use it, so legitimate names such as `..notes` become
   usable again while actual traversal remains rejected.
2. `hasGitDirSegment(relativePath)` splits on `[\\/]` and detects `.git`
   case-insensitively; `touchesGitDir` in `workspace-fs.js` reuses that same function directly,
   so the two implementations cannot drift apart.
3. After the lexical check, `resolveInside` runs
   `hasGitDirSegment(path.relative(base, nodeReal))` again on the realpath of the **deepest
   existing node**. Links that are innocuously named but resolve into `.git` are therefore
   rejected, while ordinary names such as `.gitignore`, `.github/**`, and `git.txt` are
   unaffected.
4. Add `isPathInside(root, candidate)` for use with a **resolved absolute path**;
   `resolveGitPath` in `git.js` uses it instead of hand-writing `rel.startsWith('..')`.
5. `workspace-fs.js` adds `canonicalInside(cwd, target)`: before the privileged operation it
   realpaths the target and **again** verifies `isPathInside` and the `.git` segment;
   `listDir`, `readFile`, `readFileMedia`, and `writeFile` all go through it, and subsequent
   actual reads/writes use the resolved path rather than the requested lexical path.
6. Before returning, `resolveAuthorizedCwd` re-checks
   `hasGitDirSegment(path.relative(root, real))` against the **trusted root** rather than the
   caller's cwd. A cwd inside `.git` — directly, in a subdirectory, or through an innocuous
   link — returns null, so no caller can turn a restricted directory into an authorized one by
   moving its base.
7. New `isAbsentNode(node)` (present when `lstat` succeeds): when realpath fails,
   `resolveInside` and `canonicalInside` may walk upward only for a node that is **genuinely
   absent**; a node that exists but cannot be resolved (a dangling link, an unreadable entry)
   is refused outright. `writeFile` performs `canonicalInside` on the **complete target**
   (final component included) and writes to that canonical path instead of validating only the
   parent and appending the original basename.

The `.git` rejection message remains `Saving inside .git is not allowed.` (for an explicit
segment match); cases detected through the resolved path fall under `Path is outside the
workspace.`, and both fail closed.

## Alternatives considered

- **Add the link check only in `workspace-fs.js`** — rejected: `resolveInside` is the common
  entry point for all file, Git, preview, and editor capabilities; patching only one place
  would leave Git and preview paths treating `.git` as an addressable target.
- **Use `startsWith` in `writeFile` for a second prefix/suffix comparison** — rejected: that
  exact pattern caused the `..notes` false positive; rejection must be judged **per segment**,
  and containment must be judged on the **resolved path**.
- **Just hide `.git` like any other gitignored directory** — rejected: hiding is not the same
  as making it unaddressable. A caller can request `.git/hooks/pre-commit` directly, and hooks
  are executable code.
- **Use `lstat` to ban all links** — rejected: the workspace relies on **in-root** links such
  as the pnpm store (covered by the existing case `resolveInside keeps directory links that
  stay inside the workspace`), and banning every link would break normal loading. The correct
  boundary is “after resolution it must still be inside the root and must not land in `.git`”.
- **Claim that the realpath re-check eliminates all races** — rejected: the re-check only
  narrows the window; it cannot turn “check → use” into an atomic operation. That limitation
  is recorded in Risks.
- **Anchor the `.git` rule to the caller's cwd only** — rejected: the caller's cwd is itself
  untrusted input; the rule must be anchored to the authorized root, otherwise moving the base
  directory into `.git` bypasses it.
- **Treat every realpath failure as “this path does not exist yet”** — rejected: a dangling
  link and a genuinely absent node are indistinguishable at the realpath level and must be
  separated with `lstat` first; otherwise a static link alone can redirect a write out of root.

## Acceptance criteria

`node --test src/main/workspace-authority.test.js src/main/workspace-fs.test.js` is green
(35/35), including:

- `resolveInside allows real names that merely begin with two dots`: `..notes`, `sub/..cache`,
  and `..dir/inner.txt` are accepted; `..`, `../outside.txt`, and `sub/../../outside.txt` are
  rejected.
- `resolveInside refuses .git reached through an innocuously named link`: both the directory
  junction from `notes` to `.git` and the file link from `config-link` to `.git/config` are
  rejected, and the links themselves are not treated as addressable targets.
- `resolveInside refuses .git spelled with mixed case and separators`: `.git`, `.GIT`,
  `.Git/hooks/pre-commit`, `sub/.git/config`, and `.git\config` are all rejected; `.gitignore`
  and `src/git.txt` remain usable.
- `L-4b`: writing into `.git` through an innocuous link is rejected, the sentinel bytes in
  `.git/hooks/pre-commit` and `.git/config` are unchanged, and `listDir` does not list `.git`.
- `L-4c`: after deterministically swapping in a link at the privileged call site, the save
  must fail, the sentinel bytes remain unchanged, and `.git/target.txt` does not exist.
  Replacing `canonicalInside`'s realpath with the lexical parent path makes it fail
  (mutation-verified).
- `resolveAuthorizedCwd refuses a cwd anchored inside .git`: `<root>/.git`,
  `<root>/.git/hooks`, and a cwd that resolves into `.git` through an innocuous link all
  return null, while an ordinary nested project cwd (`src/nested`) is still accepted.
- `resolveInside refuses a dangling link instead of treating it as absent`: a link pointing at
  a **missing** file outside the root is rejected, while a genuinely missing name
  (`brand-new.txt`) remains a valid creation target.
- `L-4d`: writing through a dangling link is rejected and the out-of-root target file is not
  created; the same case then proves that an ordinary missing file can still be created.
  The link fixtures in `L-4b` / `L-4c` are now created independently and prove themselves
  (asserting that realpath lands on the intended target), so a failed fixture is no longer
  counted as a successful denial.

Mutation verification (`.tmp/audit-iteration7-b1-mutation.txt`): removing the trusted-root
anchor check makes `resolveAuthorizedCwd` return `<root>/.git` and fails the corresponding
case; removing the `isAbsentNode` discrimination fails 1 of 35. Both have independent
regression protection.

`node --test src/main/git.test.js src/main/git-exec.test.js src/main/git-ipc-guard.test.js` is
green, and `gitStage stages real names that merely begin with two dots` asserts that `..notes`
and `sub/..cache` can be staged (visible via `git diff --cached --name-only`), while actual
traversal is still rejected.

## Risks

`canonicalInside` adds one realpath before every read or write. That is an acceptable
system-call cost, but it accumulates when batch-reading many small files; if performance
problems appear later, the answer is to cache per directory in batches, not to fall back to
lexical checks. The re-check narrows the “check → use” window to the interval between realpath
and the final read/write, but does **not eliminate** the race or make it atomic: if an attacker
can swap in a link within that brief window, a theoretical TOCTOU gap remains. Eliminating it
would require `openat`/handle-based APIs or locking the parent directory; that is not part of
this round. `hasGitDirSegment` decides `.git` by name, so a `.GIT` directory on a
case-insensitive filesystem is rejected — this is intentional, because Windows/macOS resolve it
to the same node. The rejection message for a link hit (`Path is outside the workspace.`) is
the same sentence used for an actual escape, so users cannot distinguish the two from the
message; distinguishing them would require an additional field, and this round does not change
the protocol.
