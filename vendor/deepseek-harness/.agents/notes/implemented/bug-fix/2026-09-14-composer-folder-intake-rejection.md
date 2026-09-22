# Agent Note: Composer file intake rejects folder stubs

Status: implemented

English | [中文](2026-09-14-composer-folder-intake-rejection.zh.md)

## Problem

A dropped or pasted folder arrives in `dataTransfer.files` as a `File` stub whose bytes cannot be read. The composer drafted it like any file and started a background upload that could never succeed: the worker transport failed, the card showed only the generic "upload failed, click to retry" label, retry could never recover, and the draft held the send gate — Enter even reported it as still uploading. The stored `uploads[id].message` diagnostic never reached the user.

## Decision

Directory classification happens at the intake site, where the `DataTransferItem` FileSystem entry is still available: `item.webkitGetAsEntry()?.isDirectory === true` marks the stub as rejected rather than drafting it. The drop listener in `ui-attachment` and the paste command in the composer keymap both pass the accepted `files` and `rejected` lists to the owner through `onAddFiles`/`intakeFiles`; the owner announces rejected entries with a localized toast and drafts only real files. Drop also sweeps `dataTransfer.files` for entries no item claimed, so an unproductive `items` list (string-kind or `getAsFile` returning `null`) cannot silently lose files — the sweep dedupes by position because every accessor mints a distinct `File` ([positional dedup](2026-09-18-composer-file-intake-positional-dedup.md)); intake sites without an item list (the file picker) keep the previous `dataTransfer.files` path. The picker cannot produce folders, and an entry-less item is treated as a file. The failed card's `title` tooltip now carries the recorded upload `message`, and the submit gate announces a failed upload as failed instead of "still uploading".

## Alternatives considered

**Filter inside `createDrafts`/`addFiles`.** By that point only `File` objects remain and a directory stub is indistinguishable from a real zero-byte file — the `FileSystemEntry` answer exists only on the `DataTransferItem` at drop/paste time.

**Read a byte to detect unreadable stubs.** Probing `file.slice(0, 1)` adds an async step on the synchronous drop path and still cannot separate an empty file from a directory, so it was rejected in favor of the in-band entry classifier.

**Auto-remove failed uploads.** The send gate keeps requiring an explicit retry-or-remove decision; silently dropping a failed draft would lose user intent. The fix narrows the announcement so the state stops masquerading as an in-flight upload.

## Consequences

Folder drops and pastes no longer produce doomed drafts; users see a localized rejection toast naming the folder. Failed uploads keep blocking send until retried or removed, but the card tooltip shows the transport's real message and Enter reports the failure accurately. `FileCard` gains an optional `reason` prop and `ComposerAttachmentsOwnerProps.onAddFiles` an optional `rejected` argument; both stay backward compatible for other slot owners.
