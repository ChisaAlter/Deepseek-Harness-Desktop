# Agent Note: Server-default remote connection

English | [中文](2026-09-05-remote-server-default.zh.md)

Status: implemented

## Decision

The desktop labels relay mode Server instead of Away and defaults missing modes to relay across config, pairing URL selection, and the settings view. Explicit LAN choices remain valid. Pairing activation, saved endpoints, and transport protocols are unchanged.

## Rationale

A label-only change leaves first-run pairing on a local-network landing page. Matching defaults across consumers makes the default select the public landing page without forcing existing LAN users to switch or enabling remote access. Tests pin host normalization and the rendered selected radio.
