/**
 * Durable storage-domain declaration for lifecycle-bound message feedback.
 * @module @deepseek-ai/dsh-message-feedback/src/spec
 */
import { z } from 'zod';
import type { SessionId } from '@deepseek-ai/dsh-session/types';
import type { MessageFeedbackItem, MessageFeedbackVersion } from './types.ts';
/** Runtime schema for the closed rating vocabulary. */
export declare const messageFeedbackRatingSchema: z.ZodUnion<readonly [z.ZodLiteral<"positive">, z.ZodLiteral<"negative">]>;
/** Runtime schema for one opaque item version stored on disk. */
export declare const messageFeedbackVersionSchema: z.ZodPipe<z.ZodUUID, z.ZodTransform<MessageFeedbackVersion, string>>;
/** Runtime schema for one current feedback item. */
export declare const messageFeedbackItemSchema: z.ZodType<MessageFeedbackItem>;
/** Persisted Session fields that fence a sidecar row to one log lifecycle. */
export declare const messageFeedbackSessionIdentitySchema: z.ZodObject<{
    createdAt: z.ZodNumber;
    cwd: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
/** Persisted lifecycle identity inferred from its durable schema. */
export type MessageFeedbackSessionIdentity = z.infer<typeof messageFeedbackSessionIdentitySchema>;
/**
 * One whole-Session sidecar. Duplicate message ids would make item lookup
 * ambiguous; duplicate versions would break their independent identity.
 */
export declare const messageFeedbackRowSchema: z.ZodObject<{
    session: z.ZodObject<{
        createdAt: z.ZodNumber;
        cwd: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>;
    items: z.ZodArray<z.ZodType<MessageFeedbackItem, unknown, z.core.$ZodTypeInternals<MessageFeedbackItem, unknown>>>;
}, z.core.$strip>;
/** Durable sidecar row inferred from {@link messageFeedbackRowSchema}. */
export type MessageFeedbackRow = z.infer<typeof messageFeedbackRowSchema>;
/** One lifecycle-bound sidecar record per Session id. */
export declare const messageFeedbackDomainSpec: {
    name: string;
    version: number;
    tables: {
        sessions: import("@deepseek-ai/dsh-storage-domain").DomainTableSpec<SessionId, {
            session: {
                createdAt: number;
                cwd?: string | undefined;
            };
            items: MessageFeedbackItem[];
        }>;
    };
};
//# sourceMappingURL=spec.d.ts.map