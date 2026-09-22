/**
 * Durable storage-domain declaration for lifecycle-bound message feedback.
 * @module @deepseek-ai/dsh-message-feedback/src/spec
 */
import { z } from 'zod';
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain';
const nonNegativeSafeInteger = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
/** Runtime schema for the closed rating vocabulary. */
export const messageFeedbackRatingSchema = z.union([
    z.literal('positive'),
    z.literal('negative'),
]);
/** Runtime schema for one opaque item version stored on disk. */
export const messageFeedbackVersionSchema = z.uuid()
    .transform(value => value);
/** Runtime schema for one current feedback item. */
// Zod infers transformed branded fields structurally, so it cannot name the
// public interface even though every branded output is created below.
export const messageFeedbackItemSchema = z.object({
    messageId: z.string().min(1).transform(value => value),
    rating: messageFeedbackRatingSchema,
    note: z.string().refine(note => note.trim().length > 0, {
        message: 'message feedback note must contain a non-whitespace character',
    }).optional(),
    version: messageFeedbackVersionSchema,
    createdAt: nonNegativeSafeInteger,
    updatedAt: nonNegativeSafeInteger,
}).refine(item => item.updatedAt >= item.createdAt, {
    path: ['updatedAt'],
    message: 'message feedback updatedAt must not precede createdAt',
});
/** Persisted Session fields that fence a sidecar row to one log lifecycle. */
export const messageFeedbackSessionIdentitySchema = z.object({
    createdAt: nonNegativeSafeInteger,
    cwd: z.string().optional(),
});
/**
 * One whole-Session sidecar. Duplicate message ids would make item lookup
 * ambiguous; duplicate versions would break their independent identity.
 */
export const messageFeedbackRowSchema = z.object({
    session: messageFeedbackSessionIdentitySchema,
    items: z.array(messageFeedbackItemSchema),
}).superRefine((row, ctx) => {
    const messageIds = new Set();
    const versions = new Set();
    row.items.forEach((item, index) => {
        if (messageIds.has(item.messageId)) {
            ctx.addIssue({
                code: 'custom',
                path: ['items', index, 'messageId'],
                message: `duplicate message feedback id '${item.messageId}'`,
            });
        }
        messageIds.add(item.messageId);
        if (versions.has(item.version)) {
            ctx.addIssue({
                code: 'custom',
                path: ['items', index, 'version'],
                message: `duplicate message feedback version '${item.version}'`,
            });
        }
        versions.add(item.version);
    });
});
/** One lifecycle-bound sidecar record per Session id. */
export const messageFeedbackDomainSpec = defineDomain({
    name: 'message_feedback',
    version: 0,
    tables: {
        sessions: domainTable(messageFeedbackRowSchema),
    },
});
//# sourceMappingURL=spec.js.map