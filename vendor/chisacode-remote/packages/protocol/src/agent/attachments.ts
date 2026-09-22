import { z } from "zod/v3";

export const GitHubPrAttachmentSchema = z.object({
  type: z.literal("github_pr"),
  mimeType: z.literal("application/github-pr"),
  number: z.number().int().positive(),
  title: z.string(),
  url: z.string(),
  body: z.string().nullable().optional(),
  baseRefName: z.string().nullable().optional(),
  headRefName: z.string().nullable().optional(),
});

export const GitHubIssueAttachmentSchema = z.object({
  type: z.literal("github_issue"),
  mimeType: z.literal("application/github-issue"),
  number: z.number().int().positive(),
  title: z.string(),
  url: z.string(),
  body: z.string().nullable().optional(),
});

export const TextAttachmentSchema = z.object({
  type: z.literal("text"),
  mimeType: z.literal("text/plain"),
  title: z.string().nullable().optional(),
  text: z.string(),
});

export const ReviewAttachmentContextLineSchema = z.object({
  oldLineNumber: z.number().int().positive().nullable(),
  newLineNumber: z.number().int().positive().nullable(),
  type: z.enum(["add", "remove", "context"]),
  content: z.string(),
});

export const ReviewAttachmentCommentSchema = z.object({
  filePath: z.string(),
  side: z.enum(["old", "new"]),
  lineNumber: z.number().int().positive(),
  body: z.string(),
  context: z.object({
    hunkHeader: z.string(),
    targetLine: ReviewAttachmentContextLineSchema,
    lines: z.array(ReviewAttachmentContextLineSchema),
  }),
});

export const REVIEW_ATTACHMENT_MIME_TYPE = "application/chisacode-review";
export const LEGACY_REVIEW_ATTACHMENT_MIME_TYPE = "application/chisacode-review";

export const ReviewAttachmentSchema = z.object({
  type: z.literal("review"),
  mimeType: z.enum([REVIEW_ATTACHMENT_MIME_TYPE, LEGACY_REVIEW_ATTACHMENT_MIME_TYPE]),
  cwd: z.string(),
  mode: z.enum(["uncommitted", "base"]),
  baseRef: z.string().nullable().optional(),
  comments: z.array(ReviewAttachmentCommentSchema),
});

export const AgentAttachmentSchema = z.discriminatedUnion("type", [
  GitHubPrAttachmentSchema,
  GitHubIssueAttachmentSchema,
  TextAttachmentSchema,
  ReviewAttachmentSchema,
]);

function normalizeAgentAttachments(input: unknown): AgentAttachment[] {
  if (!Array.isArray(input)) {
    return [];
  }
  const normalized: AgentAttachment[] = [];
  for (const item of input) {
    const parsed = AgentAttachmentSchema.safeParse(item);
    if (parsed.success) {
      normalized.push(parsed.data);
    }
  }
  return normalized;
}

export const AgentAttachmentsSchema = z.unknown().transform(normalizeAgentAttachments).optional();

export type AgentAttachment = z.infer<typeof AgentAttachmentSchema>;
export type ReviewAttachment = z.infer<typeof ReviewAttachmentSchema>;
