/**
 * Durable, lifecycle-bound feedback for finalized assistant messages.
 * @module @deepseek-ai/dsh-message-feedback
 */
import { Context, Service } from '@deepseek-ai/cordis';
import s from '@deepseek-ai/schemastery';
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import type { MessageFeedbackDeleteRequest, MessageFeedbackDeleteResult, MessageFeedbackListRequest, MessageFeedbackListResult, MessageFeedbackPutRequest, MessageFeedbackPutResult } from './types.ts';
export type * from './types.ts';
export { messageFeedbackDomainSpec, messageFeedbackItemSchema, messageFeedbackRatingSchema, messageFeedbackRowSchema, messageFeedbackSessionIdentitySchema, messageFeedbackVersionSchema, } from './spec.ts';
export type { MessageFeedbackRow, MessageFeedbackSessionIdentity } from './spec.ts';
/** Required deployment policy for optional notes. */
export interface Config {
    /** Maximum UTF-8 byte length accepted for one note. */
    readonly maxNoteBytes: number;
}
declare module '@deepseek-ai/cordis' {
    interface Context {
        messageFeedback: MessageFeedbackService;
    }
}
/**
 * Storage-domain sidecar service. It inspects persisted Session history and
 * never creates or resumes an Agent or Session.
 */
export declare class MessageFeedbackService extends TypertRemoteService {
    static inject: string[];
    /** Loader validation for the required note-size policy. */
    static Config: s<Config>;
    private readonly maxNoteBytes;
    private table?;
    private readonly operationTails;
    private mutationAdmissionOpen;
    /**
     * @param ctx - Host context carrying persistence and the storage-domain form.
     * @param config - Required note-size policy.
     */
    constructor(ctx: Context, config: Config);
    /** Open and own the one message-feedback sidecar domain. */
    protected [Service.init](): Promise<void>;
    /**
     * Read feedback belonging to the current persisted Session lifecycle.
     * A stale row from a reused Session id is invisible.
     * @param request - Session identity to inspect and list.
     * @returns current immutable items or `session-not-found`.
     */
    list(request: MessageFeedbackListRequest): Promise<MessageFeedbackListResult>;
    /**
     * Create or replace feedback for one derived append-origin assistant
     * message. Every request must match the addressed item's current version;
     * a matching no-op returns the stored item without changing its revision.
     * @param request - target, desired value, and observed item version.
     * @returns the committed item or an explicit business failure.
     */
    put(request: MessageFeedbackPutRequest): Promise<MessageFeedbackPutResult>;
    /**
     * Delete one feedback item. Absence is successful regardless of the
     * supplied version; an existing item requires an exact version match.
     * @param request - Session, message, and observed item version.
     * @returns the stable absent postcondition, or an explicit failure.
     */
    delete(request: MessageFeedbackDeleteRequest): Promise<MessageFeedbackDeleteResult>;
    /**
     * Resolve a live owner directly; otherwise use the storage catalog as the
     * existence authority before inspecting the log. Inspection failures for a
     * catalogued Session remain infrastructure failures rather than being
     * guessed into the business `session-not-found` branch.
     */
    private inspectSession;
    /** Require the exact finalized append-origin assistant message projection. */
    private hasFeedbackTarget;
    /**
     * Put the target log prefix behind a durability barrier before its sidecar.
     * A live owner flushes through the SessionStore's canonical checkpoint; a
     * cold owner is re-read from the physical durable prefix.
     */
    private ensureTargetDurable;
    /** Validate optional-note semantics and the configured complete UTF-8 byte bound. */
    private resolveNote;
    /** Return the authoritative item needed to reconcile one failed comparison. */
    private versionConflict;
    /** Queue a complete read/compare/write mutation behind this Session's prior mutation. */
    private enqueue;
    /** Resolve the initialized durable table or fail a broken service lifecycle. */
    private requireTable;
}
export default MessageFeedbackService;
//# sourceMappingURL=index.d.ts.map