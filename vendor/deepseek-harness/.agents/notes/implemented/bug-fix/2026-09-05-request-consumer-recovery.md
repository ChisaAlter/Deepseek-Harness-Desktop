# Agent Note: Restore request consumers and tool-call boundaries

English | [中文](2026-09-05-request-consumer-recovery.zh.md)

Status: implemented

## Problem

Mounted vision settings are ineffective without request rewriting and image admission consumers. Rewriting alone conflicts with log reconstruction, and descriptions missing from the generated durable event vocabulary prevent reliable reloads. Separately, permissive completed tool-call assembly admits malformed identities into execution and subsequent provider history.

## Decision

The loop invokes the optional vision service before dispatch. Upload, file-image, and local child continuation admission recognize its configuration while retaining their other guards. Descriptions are logged before the primary request; reconstruction reads those descriptions without generating them. The generated event vocabulary recognizes `vision/describe`.

Shared identity validation guards adapter completion, assembled executable content, and tool registration. Malformed responses use `MALFORMED_RESPONSE` and the existing retry policy. Raw chunks remain forensic evidence; no invalid assistant message or tool execution is committed. History repair removes invalid calls and associated results from the projection only, clearing replay state on changed messages and preserving valid unfinished groups.

## Alternatives rejected

Disabling reconstruction would hide unlogged model input. Requiring users to re-enter API keys cannot repair a missing consumer. Rewriting original history or clearing plugin data destroys evidence without fixing the request boundary. Renaming malformed calls invents identities that the provider did not supply.

## Consequences

Keyless integration checks cover saved settings, auxiliary dispatch, native bypass, cancellation, failed descriptions, nested tool images, log-only reconstruction, and tool retry. Core suites run in desktop CI after the vendor build. Real-provider and installed-artifact acceptance remain separate gates; configuration presence does not validate credentials or a manually configured model's capabilities.
