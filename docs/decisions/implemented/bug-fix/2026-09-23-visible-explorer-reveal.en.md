# Decision: Complete file reveal in a visible Explorer window

Status: implemented

[中文](2026-09-23-visible-explorer-reveal.md) | English

## Problem

The delivery card's “Show file location” action calls `explorer.exe /select,` on the Host. The shared `runNativeCommand` sets `windowsHide: true`, so Windows creates an Explorer window with the file selected but leaves that window invisible. The Host accepts Explorer's delegated exit code 1 as success and the card reports completion, while the user sees no file manager. Clicking the file card itself already opens the DSHD Files and HTML Browser tabs.

## Decision

Only the Explorer GUI launch uses a command runner with `windowsHide: false`; non-GUI commands such as `wslpath` remain hidden. Windows `/select,` retains the verified file URL argument so spaces, commas, and other special characters stay encoded; WSL first translates the path with `wslpath -w`. Keep the delegated exit-code-1 handling and pin window visibility in a runner-argument test.

## Alternatives considered

- **Make every native command visible**: PowerShell, path probes, and other background commands would show console windows.
- **Route every reveal through Electron main**: independent and remote Hosts do not always share the desktop shell's filesystem, and bypassing the existing Session filesystem check would change the authorization boundary.
- **Change only the card's success message**: it would not make the hidden Explorer window visible.

## Consequences

Selecting file location opens a visible Windows Explorer window with the target file selected; failures remain retryable on the delivery card. Windows and WSL share this behavior. macOS Finder and the Linux default file manager keep their existing launch paths. Clicking the card itself continues to preview through `workspaces.openPath` in the right panel.
