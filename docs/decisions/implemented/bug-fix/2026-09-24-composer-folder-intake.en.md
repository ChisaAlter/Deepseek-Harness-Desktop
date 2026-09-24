# Decision: Submit only regular files after rejecting folders in the composer

Status: implemented

[中文](2026-09-24-composer-folder-intake.md) | English

## Problem

The composer displayed a rejection notice for folders detected during paste or drop, but still passed the original file list to `addFiles`. A folder could therefore reach attachment processing, and regular files in a mixed batch could not be handled independently with confidence.

## Decision

The composer removes folders identified by directory metadata from the batch. It keeps the existing folder rejection notice and passes only regular files to `addFiles`. A folder-only batch does not call the attachment entry point. A mixed batch still processes regular files and can display both folder and file rejection reasons in one notice. The attachment entry point retains its single-argument file-list interface.

## Alternatives considered

- **Pass folders and a directory set to `addFiles`**: this shifts a rejection already determined by the composer to an attachment entry point whose current interface accepts only a file list.
- **Reject the entire mixed batch**: this prevents valid regular files in that batch from being added.

## Consequences

Folders do not reach attachment processing, while valid files can still be added. Focused composer tests cover pasted folders, mixed drops, and multiple rejection reasons in one batch.
