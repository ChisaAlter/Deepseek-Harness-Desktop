import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import { Service } from "@deepseek-ai/cordis";
import s from "@deepseek-ai/schemastery";
import { deriveEventMessage, isAppendSurfaceEvent } from "@deepseek-ai/dsh-session/surface";
import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import { z } from "zod";
import { defineDomain, domainTable } from "@deepseek-ai/dsh-storage-domain";
//#region lib/types/spec.js
/**
* Durable storage-domain declaration for lifecycle-bound message feedback.
* @module @deepseek-ai/dsh-message-feedback/src/spec
*/
const nonNegativeSafeInteger = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
/** Runtime schema for the closed rating vocabulary. */
const messageFeedbackRatingSchema = z.union([z.literal("positive"), z.literal("negative")]);
/** Runtime schema for one opaque item version stored on disk. */
const messageFeedbackVersionSchema = z.uuid().transform((value) => value);
/** Runtime schema for one current feedback item. */
const messageFeedbackItemSchema = z.object({
	messageId: z.string().min(1).transform((value) => value),
	rating: messageFeedbackRatingSchema,
	note: z.string().refine((note) => note.trim().length > 0, { message: "message feedback note must contain a non-whitespace character" }).optional(),
	version: messageFeedbackVersionSchema,
	createdAt: nonNegativeSafeInteger,
	updatedAt: nonNegativeSafeInteger
}).refine((item) => item.updatedAt >= item.createdAt, {
	path: ["updatedAt"],
	message: "message feedback updatedAt must not precede createdAt"
});
/** Persisted Session fields that fence a sidecar row to one log lifecycle. */
const messageFeedbackSessionIdentitySchema = z.object({
	createdAt: nonNegativeSafeInteger,
	cwd: z.string().optional()
});
/**
* One whole-Session sidecar. Duplicate message ids would make item lookup
* ambiguous; duplicate versions would break their independent identity.
*/
const messageFeedbackRowSchema = z.object({
	session: messageFeedbackSessionIdentitySchema,
	items: z.array(messageFeedbackItemSchema)
}).superRefine((row, ctx) => {
	const messageIds = /* @__PURE__ */ new Set();
	const versions = /* @__PURE__ */ new Set();
	row.items.forEach((item, index) => {
		if (messageIds.has(item.messageId)) ctx.addIssue({
			code: "custom",
			path: [
				"items",
				index,
				"messageId"
			],
			message: `duplicate message feedback id '${item.messageId}'`
		});
		messageIds.add(item.messageId);
		if (versions.has(item.version)) ctx.addIssue({
			code: "custom",
			path: [
				"items",
				index,
				"version"
			],
			message: `duplicate message feedback version '${item.version}'`
		});
		versions.add(item.version);
	});
});
/** One lifecycle-bound sidecar record per Session id. */
const messageFeedbackDomainSpec = defineDomain({
	name: "message_feedback",
	version: 0,
	tables: { sessions: domainTable(messageFeedbackRowSchema) }
});
//#endregion
//#region lib/types/index.js
/**
* Durable, lifecycle-bound feedback for finalized assistant messages.
* @module @deepseek-ai/dsh-message-feedback
*/
var __runInitializers = function(thisArg, initializers, value) {
	var useValue = arguments.length > 2;
	for (var i = 0; i < initializers.length; i++) value = useValue ? initializers[i].call(thisArg, value) : initializers[i].call(thisArg);
	return useValue ? value : void 0;
};
var __esDecorate = function(ctor, descriptorIn, decorators, contextIn, initializers, extraInitializers) {
	function accept(f) {
		if (f !== void 0 && typeof f !== "function") throw new TypeError("Function expected");
		return f;
	}
	var kind = contextIn.kind, key = kind === "getter" ? "get" : kind === "setter" ? "set" : "value";
	var target = !descriptorIn && ctor ? contextIn["static"] ? ctor : ctor.prototype : null;
	var descriptor = descriptorIn || (target ? Object.getOwnPropertyDescriptor(target, contextIn.name) : {});
	var _, done = false;
	for (var i = decorators.length - 1; i >= 0; i--) {
		var context = {};
		for (var p in contextIn) context[p] = p === "access" ? {} : contextIn[p];
		for (var p in contextIn.access) context.access[p] = contextIn.access[p];
		context.addInitializer = function(f) {
			if (done) throw new TypeError("Cannot add initializers after decoration has completed");
			extraInitializers.push(accept(f || null));
		};
		var result = (0, decorators[i])(kind === "accessor" ? {
			get: descriptor.get,
			set: descriptor.set
		} : descriptor[key], context);
		if (kind === "accessor") {
			if (result === void 0) continue;
			if (result === null || typeof result !== "object") throw new TypeError("Object expected");
			if (_ = accept(result.get)) descriptor.get = _;
			if (_ = accept(result.set)) descriptor.set = _;
			if (_ = accept(result.init)) initializers.unshift(_);
		} else if (_ = accept(result)) if (kind === "field") initializers.unshift(_);
		else descriptor[key] = _;
	}
	if (target) Object.defineProperty(target, contextIn.name, descriptor);
	done = true;
};
/** Immutable empty list reused only as an input to caller-owned copying. */
const EMPTY_ITEMS = Object.freeze([]);
/** Validate the one deployment-varying limit at the configuration boundary. */
function resolveMaxNoteBytes(value) {
	if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`message-feedback: maxNoteBytes must be a positive safe integer, got ${String(value)}`);
	return value;
}
/** Copy and freeze one item before it crosses the service boundary. */
function snapshotItem(item) {
	return Object.freeze({
		messageId: item.messageId,
		rating: item.rating,
		...item.note === void 0 ? {} : { note: item.note },
		version: item.version,
		createdAt: item.createdAt,
		updatedAt: item.updatedAt
	});
}
/** Copy and freeze a list response. */
function snapshotList(items) {
	return Object.freeze({ items: Object.freeze(items.map(snapshotItem)) });
}
/** Build a frozen success branch. */
function success(value) {
	return Object.freeze({
		ok: true,
		value
	});
}
/** Build a frozen business-failure branch. */
function rejected(error) {
	return Object.freeze({
		ok: false,
		error: Object.freeze(error)
	});
}
/** Project the Session fields that distinguish one persisted log lifecycle. */
function identityOf(header) {
	return Object.freeze({
		createdAt: header.createdAt,
		...header.cwd === void 0 ? {} : { cwd: header.cwd }
	});
}
/** Whether a stored row belongs to the inspected Session lifecycle. */
function sameIdentity(row, header) {
	return row.session.createdAt === header.createdAt && row.session.cwd === header.cwd;
}
/** Whether two observations name the same persisted Session lifecycle. */
function sameHeaderIdentity(left, right) {
	return left.id === right.id && left.createdAt === right.createdAt && left.cwd === right.cwd;
}
/** Freeze the replacement row so storage-domain never exposes mutable aliases. */
function rowSnapshot(session, items) {
	const copiedItems = items.map(snapshotItem);
	Object.freeze(copiedItems);
	return Object.freeze({
		session,
		items: copiedItems
	});
}
/** Generate an opaque equality token for one material mutation. */
function nextVersion() {
	return randomUUID();
}
/**
* Storage-domain sidecar service. It inspects persisted Session history and
* never creates or resumes an Agent or Session.
*/
let MessageFeedbackService = (() => {
	let _classSuper = TypertRemoteService;
	let _instanceExtraInitializers = [];
	let _list_decorators;
	let _put_decorators;
	let _delete_decorators;
	return class MessageFeedbackService extends _classSuper {
		static {
			const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(_classSuper[Symbol.metadata] ?? null) : void 0;
			_list_decorators = [Remote("list")];
			_put_decorators = [Remote("put")];
			_delete_decorators = [Remote("delete")];
			__esDecorate(this, null, _list_decorators, {
				kind: "method",
				name: "list",
				static: false,
				private: false,
				access: {
					has: (obj) => "list" in obj,
					get: (obj) => obj.list
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _put_decorators, {
				kind: "method",
				name: "put",
				static: false,
				private: false,
				access: {
					has: (obj) => "put" in obj,
					get: (obj) => obj.put
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _delete_decorators, {
				kind: "method",
				name: "delete",
				static: false,
				private: false,
				access: {
					has: (obj) => "delete" in obj,
					get: (obj) => obj.delete
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			if (_metadata) Object.defineProperty(this, Symbol.metadata, {
				enumerable: true,
				configurable: true,
				writable: true,
				value: _metadata
			});
		}
		static inject = [
			"storageDomain",
			"sessionPersistence",
			"sessions"
		];
		/** Loader validation for the required note-size policy. */
		static Config = s.object({ maxNoteBytes: s.number().step(1).min(1).required() });
		maxNoteBytes = __runInitializers(this, _instanceExtraInitializers);
		table;
		operationTails = /* @__PURE__ */ new Map();
		mutationAdmissionOpen = true;
		/**
		* @param ctx - Host context carrying persistence and the storage-domain form.
		* @param config - Required note-size policy.
		*/
		constructor(ctx, config) {
			super(ctx, "messageFeedback");
			this.maxNoteBytes = resolveMaxNoteBytes(config.maxNoteBytes);
		}
		/** Open and own the one message-feedback sidecar domain. */
		async [Service.init]() {
			const domain = await this.ctx.storageDomain.open(messageFeedbackDomainSpec);
			this.ctx.effect(() => async () => {
				this.mutationAdmissionOpen = false;
				await Promise.all(this.operationTails.values());
				await domain.close();
			}, "message-feedback.domainClose");
			this.table = domain.table("sessions");
		}
		/**
		* Read feedback belonging to the current persisted Session lifecycle.
		* A stale row from a reused Session id is invisible.
		* @param request - Session identity to inspect and list.
		* @returns current immutable items or `session-not-found`.
		*/
		async list(request) {
			const known = await this.inspectSession(request.sessionId);
			if (!known.ok) return known;
			const row = this.requireTable().get(request.sessionId);
			return success(snapshotList(row !== void 0 && sameIdentity(row, known.value.meta) ? row.items : EMPTY_ITEMS));
		}
		/**
		* Create or replace feedback for one derived append-origin assistant
		* message. Every request must match the addressed item's current version;
		* a matching no-op returns the stored item without changing its revision.
		* @param request - target, desired value, and observed item version.
		* @returns the committed item or an explicit business failure.
		*/
		put(request) {
			const note = this.resolveNote(request.note);
			if (!note.ok) return Promise.resolve(note);
			return this.enqueue(request.sessionId, async () => {
				const known = await this.inspectSession(request.sessionId);
				if (!known.ok) return known;
				if (!this.hasFeedbackTarget(known.value, request.messageId)) return rejected({
					code: "target-not-found",
					sessionId: request.sessionId,
					messageId: request.messageId
				});
				const durable = await this.ensureTargetDurable(known.value);
				if (!sameHeaderIdentity(durable.meta, known.value.meta) || !this.hasFeedbackTarget(durable, request.messageId)) return rejected({
					code: "target-not-found",
					sessionId: request.sessionId,
					messageId: request.messageId
				});
				const table = this.requireTable();
				const stored = table.get(request.sessionId);
				const items = (stored !== void 0 && sameIdentity(stored, durable.meta) ? stored : void 0)?.items ?? EMPTY_ITEMS;
				const index = items.findIndex((item) => item.messageId === request.messageId);
				const existing = items[index];
				if (request.ifVersion !== (existing?.version ?? null)) return rejected(this.versionConflict(existing ?? null));
				if (existing !== void 0 && existing.rating === request.rating && existing.note === note.value) return success(snapshotItem(existing));
				const now = Date.now();
				const item = snapshotItem({
					messageId: request.messageId,
					rating: request.rating,
					...note.value === void 0 ? {} : { note: note.value },
					version: nextVersion(),
					createdAt: existing?.createdAt ?? now,
					updatedAt: existing === void 0 ? now : Math.max(now, existing.updatedAt)
				});
				const nextItems = [...items];
				if (index === -1) nextItems.push(item);
				else nextItems[index] = item;
				await table.put(request.sessionId, rowSnapshot(identityOf(durable.meta), nextItems));
				return success(snapshotItem(item));
			});
		}
		/**
		* Delete one feedback item. Absence is successful regardless of the
		* supplied version; an existing item requires an exact version match.
		* @param request - Session, message, and observed item version.
		* @returns the stable absent postcondition, or an explicit failure.
		*/
		delete(request) {
			return this.enqueue(request.sessionId, async () => {
				const known = await this.inspectSession(request.sessionId);
				if (!known.ok) return known;
				const table = this.requireTable();
				const stored = table.get(request.sessionId);
				const items = (stored !== void 0 && sameIdentity(stored, known.value.meta) ? stored : void 0)?.items ?? EMPTY_ITEMS;
				const existing = items.find((item) => item.messageId === request.messageId);
				if (existing === void 0) return success(Object.freeze({ absent: true }));
				if (request.ifVersion !== existing.version) return rejected(this.versionConflict(existing));
				await table.put(request.sessionId, rowSnapshot(identityOf(known.value.meta), items.filter((item) => item !== existing)));
				return success(Object.freeze({ absent: true }));
			});
		}
		/**
		* Resolve a live owner directly; otherwise use the storage catalog as the
		* existence authority before inspecting the log. Inspection failures for a
		* catalogued Session remain infrastructure failures rather than being
		* guessed into the business `session-not-found` branch.
		*/
		async inspectSession(sessionId) {
			if (this.ctx.sessions.get(sessionId) === void 0) {
				if (!(await this.ctx.sessionPersistence.listSnapshots()).some((snapshot) => snapshot.header.id === sessionId) && this.ctx.sessions.get(sessionId) === void 0) return rejected({
					code: "session-not-found",
					sessionId
				});
			}
			return success(await this.ctx.sessionPersistence.inspect(sessionId));
		}
		/** Require the exact finalized append-origin assistant message projection. */
		hasFeedbackTarget(inspection, messageId) {
			return inspection.events.some((event) => {
				if (event.type !== "assistant/message" || !isAppendSurfaceEvent(event)) return false;
				const message = deriveEventMessage(event);
				return message?.role === "assistant" && message.id === messageId;
			});
		}
		/**
		* Put the target log prefix behind a durability barrier before its sidecar.
		* A live owner flushes through the SessionStore's canonical checkpoint; a
		* cold owner is re-read from the physical durable prefix.
		*/
		async ensureTargetDurable(inspection) {
			const live = this.ctx.sessions.get(inspection.meta.id);
			if (live !== void 0 && sameHeaderIdentity(live.header, inspection.meta)) {
				if (!await this.ctx.sessions.flush(live)) throw new Error(`message-feedback: no durability listener participated for live session '${inspection.meta.id}'`);
				return await this.ctx.sessionPersistence.readFrom(inspection.meta.id, 0);
			}
			return await this.ctx.sessionPersistence.readFrom(inspection.meta.id, 0);
		}
		/** Validate optional-note semantics and the configured complete UTF-8 byte bound. */
		resolveNote(note) {
			if (note === void 0) return success(void 0);
			if (note.trim().length === 0) return rejected({ code: "note-blank" });
			const actualBytes = Buffer.byteLength(note, "utf8");
			if (actualBytes > this.maxNoteBytes) return rejected({
				code: "note-too-large",
				maxBytes: this.maxNoteBytes,
				actualBytes
			});
			return success(note);
		}
		/** Return the authoritative item needed to reconcile one failed comparison. */
		versionConflict(current) {
			return {
				code: "version-conflict",
				current: current === null ? null : snapshotItem(current)
			};
		}
		/** Queue a complete read/compare/write mutation behind this Session's prior mutation. */
		enqueue(sessionId, operation) {
			if (!this.mutationAdmissionOpen) return Promise.reject(/* @__PURE__ */ new Error("message-feedback: service is disposing"));
			const result = (this.operationTails.get(sessionId) ?? Promise.resolve()).then(operation);
			const tail = result.then(() => void 0, () => void 0);
			this.operationTails.set(sessionId, tail);
			return result.finally(() => {
				if (this.operationTails.get(sessionId) === tail) this.operationTails.delete(sessionId);
			});
		}
		/** Resolve the initialized durable table or fail a broken service lifecycle. */
		requireTable() {
			if (this.table === void 0) throw new Error("message-feedback: durable domain is not initialized");
			return this.table;
		}
	};
})();
//#endregion
export { MessageFeedbackService, MessageFeedbackService as default, messageFeedbackDomainSpec, messageFeedbackItemSchema, messageFeedbackRatingSchema, messageFeedbackRowSchema, messageFeedbackSessionIdentitySchema, messageFeedbackVersionSchema };
