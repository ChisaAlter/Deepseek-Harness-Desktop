// Intentional module public surface: aggregates the review domain's store
// and surface API. Not a convenience barrel — consumers depend on this as the
// canonical import boundary for review state and inline thread rendering.
export {
  buildReviewAttachmentSnapshot,
  buildReviewDraftKey,
  buildReviewDraftScopeKey,
  getReviewDraftComments,
  resetReviewDraftStore,
  useActiveReviewDraftMode,
  useClearReviewDraft,
  useReviewAttachmentSnapshot,
  useSetActiveReviewDraftMode,
  addReviewDraftComment,
  type BuildReviewDraftKeyInput,
  type BuildReviewDraftScopeKeyInput,
  type ReviewDraftCommentInput,
  type ReviewDraftComment,
  type ReviewDraftMode,
  type ReviewDraftSide,
} from "./store";

export {
  getInlineReviewThreadState,
  getInlineReviewThreadViewportStyle,
  getSplitInlineReviewThreadState,
  groupInlineReviewCommentsByTarget,
  InlineReviewEditor,
  InlineReviewGutterCell,
  InlineReviewThread,
  isInlineReviewEditorForTarget,
  SMALL_ACTION_HIT_SLOP,
  useInlineReviewController,
  type InlineReviewActions,
  type InlineReviewEditorState,
} from "./surface";
