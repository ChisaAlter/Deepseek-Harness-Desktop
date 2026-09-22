/**
 * Shared markdown rendering — Paseo-aligned pipeline, hosted in ChisaCode.
 *
 * Layering (organic, not wholesale replace):
 *
 *   createSharedMarkdownRules()     ← lists, strong/em, fence, tables, default link
 *            │
 *   mergeMarkdownRules(base, ext)   ← extension keys win; base fills the rest
 *            │
 *   MarkdownRenderer                ← html-ish split, themed styles, part groups
 *            │
 *   ┌────────┴────────┬──────────────────┐
 *   │                 │                  │
 * AssistantMessage  PlanCard         FilePane
 * (file links,      (shared only,    (shared only,
 *  generative UI,    compact)         full prose)
 *  agent images)
 *
 * Do not re-declare shared list/paragraph/strong rules in domain code unless
 * you intentionally replace them. Pass only ChisaCode-specific overrides.
 */
export {
  MarkdownRenderer,
  MarkdownInheritedText,
  createSharedMarkdownRules,
  type MarkdownRendererProps,
  type MarkdownStyleVariant,
  type MarkdownStyles,
} from "./renderer";
export { mergeMarkdownRules } from "./merge-rules";
export {
  splitHtmlishMarkdown,
  type MarkdownDisplayPart,
  type MarkdownDetailsPart,
  type MarkdownInlineImagePart,
  type MarkdownTextPart,
} from "./html-ish";
export { groupMarkdownParts, type MarkdownPartGroup } from "./part-groups";
