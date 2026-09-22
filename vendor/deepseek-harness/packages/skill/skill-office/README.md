---
description: "Bundled Word, PowerPoint, and Excel instructions for deployments providing Office file authoring and structural checks."
kind: "package-reference"
---

# @deepseek-ai/dsh-skill-office

English | [中文](README.zh.md)

## Summary

Agents can load Word, PowerPoint, and Excel workflows that use the bundled Python environment by default and respect explicit user or AGENTS.md environment choices. The skills cover creation, focused edits, structural checks, and file delivery. Visual inspection is conditional on image-capable models and an available rendering tool; ordinary document delivery does not require installing a renderer.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this provider beside the skill registry and `dsh-tool-skill` to expose `office-docx`, `office-pptx`, and `office-xlsx` in the session catalog. The provider supplies instructions and scripts; the deployment supplies its interpreters, authoring libraries, execution tools, and file delivery tool.

### Minimal configuration

```yaml
- name: '@deepseek-ai/dsh-skill-office'
```

| Field | Default | Meaning |
|---|---|---|
| `assetRoot` | Packaged `assets/` | Absolute resource directory containing the three skill folders and shared `scripts/`; deployments can place it outside an application archive. |

Relative paths, missing resources, and skill files without a YAML frontmatter description reject activation. Disposing the plugin removes its candidates. Project and user skill precedence remains owned by the skill registry.

### Structural checks

The shared Python checker reads DOCX, PPTX, or XLSX without modifying the source. It recognizes Transitional and Strict OOXML namespaces, validates ZIP/XML and internal package relationships, reports document structure, and optionally checks required text or slide/sheet count. DOCX text assertions cover the main body, section-referenced headers and footers, and body-referenced footnotes and endnotes; comments, glossary text, and unreferenced parts or notes do not satisfy them. It uses only the Python standard library. Invalid packages, corrupt or encrypted ZIP members, and report-file write failures produce a JSON failure report on stdout. A passing report does not establish appearance, feature preservation, or calculated formula results.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The provider registers three bundled candidates and reads their descriptions from the shipped YAML frontmatter at activation. Loaded instruction bodies exclude that metadata. Each loaded skill exposes its own filesystem directory, so the execution tool can resolve the shared checker without relying on the task working directory. Configurable external resources support carriers whose application archive is not readable by Python.

| File | Responsibility |
|---|---|
| [`src/index.ts`](src/index.ts) | Provider registration and configured resource paths. |
| [`assets/`](assets/) | Three workflows and the read-only OOXML checker. |
| — | No runtime invariant companion is published: the provider owns immutable candidates, and the skill registry owns registration lifecycle and precedence. |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Skill registry](../skill/README.md) — discovery and precedence.
- [Skill tool](../tool-skill/README.md) — model-visible catalogs and bodies.
- [File delivery](../../deliverables/tool-present/README.md) — current source-path delivery.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through `dsh-tool-skill`, which renders the catalog entries and selected instruction body.

#### KV Cache effect

Mounting the provider adds three catalog entries; loading a skill adds its body at the existing skill-tool insertion point. The provider does not add separate prompt sections.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The provider does not install Python, authoring libraries, or a rendering engine. The checker requires Python 3.9 or later.
- Structural checks do not judge pagination, clipping, fonts, chart appearance, or Excel recalculation.
- The checker accepts DOCX, PPTX, and XLSX only; legacy, encrypted, and macro-enabled formats require an appropriate separate workflow.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
