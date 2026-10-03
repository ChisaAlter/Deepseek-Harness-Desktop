---
name: dshd-checks
description: Find relevant product and tooling checks in WhaleIsle.
---

# Check entry points

Use [maintenance](../../../docs/maintenance/README.md) for the development workflow.

- Product tests: `npm test`, or a relevant existing test file.
- Build/release/tool tests: `npm run test:tools`.
- Optional Markdown links: `npm run docs:check`.
- Actual UI and installation tools: locate the relevant module in the [handbook](../../../docs/handbook/README.md).
- CI and release: [operations](../../../docs/handbook/modules/release-process.md).

Feature Gates locate existing checks; they are not mandatory full lists. No local-QA certificate, candidate signoff or full-suite prerequisite for development CI.
