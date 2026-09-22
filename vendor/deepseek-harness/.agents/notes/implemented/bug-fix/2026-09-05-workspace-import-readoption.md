# Agent Note: Re-adopt imported sessions when registering a workspace

English | [中文](2026-09-05-workspace-import-readoption.zh.md)

Status: implemented

## Problem

An initialized workspace registry does not bootstrap again after session import. Returning an existing workspace without refreshing membership leaves later imported histories inaccessible through that registration. Cached failed cwd resolutions also hide histories after their original directory becomes available.

## Decision

Explicit directory registration refreshes persisted headers for both new and existing workspaces. Unaccounted sessions with matching canonical cwd are adopted newest-first through the existing entity mutation path. Existing identities, titles, member order, and archive state are preserved. Repeated registration without new histories makes no durable change.

## Alternatives considered

**Repeat bootstrap on every launch.** This resurrects deliberately deleted workspace registrations. Explicit registration retains user control.

**Rewrite imported cwd values.** A moved directory cannot be inferred reliably, and rewriting original session logs changes historical execution context. Only a matching original directory is accepted.

## Consequences

Registration performs a fresh header scan and path validation. Event bodies and source homes remain untouched. The workspace tests cover later imports, idempotence, persisted membership after restart, and a directory restored after startup.
