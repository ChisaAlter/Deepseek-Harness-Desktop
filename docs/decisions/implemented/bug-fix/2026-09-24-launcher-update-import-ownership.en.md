# Decision: Launcher ownership of update confirmations and import tasks

Status: implemented

[中文](2026-09-24-launcher-update-import-ownership.md) | English

## Problem

After showing version A at cold start, the installer fetched `/releases/latest` again and could install version B. If the visible launcher closed during confirmation, the update result had already been removed from the in-memory queue and was lost. A returned `{ok:false}` from automatic desktop start was still reported as a successful desktop outcome. Concurrent imports replaced one cancellation controller and wrote one journal; an empty selection created a completed journal too.

## Decision

The update confirmation passes the same release snapshot to installation. That path does not query latest again or use the updater's moving `latest.yml`; it downloads the full Setup named by the snapshot and retains SHA512 verification. A confirmation abandoned by a stale window puts the result back in the queue. A failed automatic start reports a launcher outcome, and the visible launcher drains a late update result. The main process acquires the import task lock before stopping the kernel. A second request returns `import-in-progress`, and completion or failure releases the lock. An empty selection retains its result and progress event without writing a journal.

## Alternatives considered

- **Refresh latest after confirmation and compare the version**: an asset under the same tag can still change, and a second network failure changes an already confirmed operation.
- **Keep using the updater's latest.yml**: the remote latest metadata chooses its target and cannot guarantee the release shown in the confirmation. A separately published delta package will be designed in the subsequent delivery work.
- **Disable only the import page button**: IPC can receive concurrent calls, and a refreshed window or another caller can replace the cancellation target. The main process must own exclusion.

## Consequences

The cold-start confirmation path downloads a full package until a delta manifest can bind a specific target version. An empty import leaves no journal. Focused tests cover closing a window during confirmation, release snapshot passing, late updates after a start failure, concurrent imports, and retry after failure.
