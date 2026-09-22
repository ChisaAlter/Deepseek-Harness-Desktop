// Intentional module public surface: aggregates the assistant file-link
// domain's link components, parser, provider and resolver API. Not a
// convenience barrel — consumers depend on this as the canonical import boundary.
export {
  AssistantInlineCodePathLink,
  AssistantMarkdownCodeLink,
  AssistantMarkdownLink,
} from "./link";
export {
  classifyAssistantFileLink,
  normalizeInlinePathTarget,
  type InlinePathTarget,
} from "./parse";
export {
  AssistantFileLinkResolverProvider,
  type AssistantFileLinkResolverProviderProps,
} from "./provider";
export type { AssistantFileLinkSource } from "./resolver";
export { useAssistantFileLinkActions } from "./use-file-link";
