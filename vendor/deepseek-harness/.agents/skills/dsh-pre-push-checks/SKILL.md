---
name: dsh-pre-push-checks
description: Locate relevant Harness checks under the sole WhaleIsle maintenance policy; no independent push workflow.
---

# Harness checks inside WhaleIsle

[WhaleIsle maintenance](../../../../../docs/maintenance/README.md) is the sole project maintenance policy, including when working directly in this vendor directory. This skill supplies navigation only.

Inspect the owning module and outgoing diff to locate existing behavior, build and integration commands. Their selection, development order and completion conditions come from that policy. Use the host [verification entry](../../../../../.devin/skills/dshd-checks/SKILL.md) and [release operations](../../../../../docs/handbook/modules/release-process.md).

No standalone pre-push typecheck, full doc-sync/lint ladder, automatic CI or `gh stack sync` before-validation exception applies. History and upstream workflow descriptions explain provenance without authorizing execution. Host hooks and actual local QA remain separate evidence.