# Agent Note: Hidden agent presets

Status: implemented

English | [中文](2026-09-16-hidden-agent-presets.zh.md)

## Problem

A plugin can provision its own agent preset under the user root so the sessions it creates mount a dedicated composition — dshbot provisions `dshbot-room` for its group rooms, and the desktop whale assistant provisions `whale-girl` for her standing session. Discovery reports every provisioned preset on the roster, so both appeared in the preset picker beside the shipped `standard`/`ptc`/`minimal`/`cordis` set even though they exist to compose sessions the owning plugin creates, not to be picked by a person. The `dshbot-room` description already read "create groups from the Bots tab, not this picker" — warning text standing in for a mechanism the metadata had no field for.

## Decision

`preset.yml` carries an optional `hidden: true` flag, parsed in `metadata.ts` onto `PresetMetadata` and through discovery onto `AgentPreset`. Only the literal `true` hides: a mistyped value leaves the preset visible rather than silently removing it from the roster.

Hiding lives at the client-facing projection, `remoteExportList`, which omits a hidden preset while it can compose. Host-side `list()`, `resolve()`, and the mount path never consult the flag — hidden is presentation, never capability — so sessions a plugin creates by id, and host consumers such as the IM channel's per-bot preset catalog, keep working unchanged.

A hidden preset that cannot load still lists with its `broken` reason: the roster is also the surface where its directory gets deleted, and a stale provisioned directory keeps occupying its id. `compositionInventory()` stays complete for the same class of reason — it reports which presets mount which plugins, and dropping a hidden preset there would misreport the mount graph a diagnostic surface exists to describe.

Copying a hidden preset produces a visible one: `copyComposition` rewrites `preset.yml` from `name`/`description` alone, so a copy of an internal composition lists on the pickers it was authored for.

## Alternatives considered

- **Filter inside each picker.** The client's `presetOptions()` could skip hidden rows, but the flag would ride the wire for every surface to reimplement the same exclusion, and the settings section's roster would keep offering internal presets for copying. The remote projection is the one place every browser-facing roster read flows through.
- **Provision into a private root.** A plugin-only root keeps internal presets off the user root entirely, but discovery roots are a deployment configuration, not a per-plugin channel, and a root nothing lists leaves no surface able to report or delete a stale directory. The user root plus a visibility flag keeps one provisioning mechanism.
- **Hide by id convention.** A name prefix or a description marker needs no schema change, but conflates naming with presentation and cannot express "hidden while healthy, listed while broken".

## Consequences

`AgentPreset` gained a `hidden` field; the wire `AgentPresetRow` is unchanged because filtered rows never serialize. A healthy hidden preset is invisible to pickers and to the management section — deleting its directory is a filesystem operation, which is honest because the provisioning plugin would restore it on the next start anyway. A plugin that stops provisioning, or whose provisioned copy breaks, leaves a `broken` row the user can still see and remove. One cosmetic edge: a session running on a hidden preset names its composition by the bare id in the header label, because the roster row carrying its display name is gone — the id is the honest label there.

Related: [per-session agent presets](2026-08-03-per-session-agent-presets.md) owns the preset model this extends; [copy-only preset authoring](../simplification/2026-08-08-copy-only-preset-authoring.md) owns the copy path that drops the flag.
