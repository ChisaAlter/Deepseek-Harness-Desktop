// Vendored snapshot of vendor/deepseek-harness/packages/client/shortcuts/
// lib/protocol.js (upstream pin 0.1.7-rc.2). The packaged build ships the
// vendored harness inside resources/vendor/deepseek-harness.tar, so the
// main-process bridge cannot import the workspace lib at runtime; this copy
// inlines the two leaf imports (assertNever, randomUUID) and must be
// regenerated if the upstream protocol module changes.
import { randomUUID } from 'node:crypto';

/** Mark an unreachable closed-union branch (mirrors dsh-util-values). */
function assertNever(value, context) {
	const rendered = JSON.stringify(value) ?? String(value);
	throw new Error(`unreachable variant${context ? ` in ${context}` : ''}: ${rendered}`);
}
//#region lib/types/binding.js
const keyNames = {
	Slash: "/",
	Comma: ",",
	Period: ".",
	Backslash: "\\",
	Backquote: "`",
	Minus: "-",
	Equal: "=",
	BracketLeft: "[",
	BracketRight: "]",
	Semicolon: ";",
	Quote: "'",
	Enter: "Enter",
	Escape: "Esc",
	Space: "Space",
	Tab: "Tab",
	Backspace: "Backspace",
	Delete: "Delete",
	ArrowUp: "↑",
	ArrowDown: "↓",
	ArrowLeft: "←",
	ArrowRight: "→"
};
const modifierOrder = [
	"control",
	"alt",
	"shift",
	"meta"
];
/**
* Expand logical modifiers, deduplicate, and validate the physical code.
* @param binding - declared binding.
* @param platform - receiving device platform.
* @returns canonical binding; unsupported codes throw during registration.
*/
function normalizeBinding(binding, platform) {
	const codes = [binding.code, ...binding.secondCode === void 0 ? [] : [binding.secondCode]];
	codes.sort();
	for (const code of codes) if (!/^(Key[A-Z]|Digit[0-9]|F([1-9]|1[0-9]|2[0-4]))$/u.test(code) && !Object.hasOwn(keyNames, code)) throw new Error(`Unsupported shortcut code: ${code}`);
	if (codes.length === 2 && codes[0] === codes[1]) throw new Error("Shortcut keys must be distinct");
	const modifiers = new Set(binding.modifiers.map((value) => value === "primary" ? platform === "macos" ? "meta" : "control" : value));
	return {
		code: codes[0],
		...codes[1] === void 0 ? {} : { secondCode: codes[1] },
		modifiers: modifierOrder.filter((value) => modifiers.has(value))
	};
}
/**
* Produce an exact-match index from a normalized binding.
* @param binding - normalized physical key and modifiers.
* @returns stable index used for both matching and conflict checks.
*/
function bindingKey(binding) {
	const codes = binding.secondCode === void 0 ? [binding.code] : [binding.code, binding.secondCode].sort();
	return [...binding.modifiers, ...codes].join("+");
}
/**
* Format keycaps and ARIA; Windows separates modifiers with plus signs, while chord keys remain adjacent.
* @param binding - normalized binding, or null for an unbound command.
* @param platform - receiving device platform.
* @returns visible keycaps; two-key chords omit ARIA shortcuts, which only support one non-modifier key.
*/
function presentBinding(binding, platform) {
	if (binding === null) return {
		keys: [],
		aria: void 0
	};
	const key = keyNames[binding.code] ?? binding.code.replace(/^(Key|Digit)/u, "");
	const symbols = platform === "macos" ? {
		control: "⌃",
		alt: "⌥",
		shift: "⇧",
		meta: "⌘"
	} : {
		control: "Ctrl",
		alt: "Alt",
		shift: "Shift",
		meta: "Meta"
	};
	const ariaNames = {
		control: "Control",
		alt: "Alt",
		shift: "Shift",
		meta: "Meta"
	};
	const ariaKey = binding.code === "Space" ? "Space" : binding.code === "Escape" ? "Escape" : binding.code.startsWith("Arrow") ? binding.code : key;
	const second = binding.secondCode === void 0 ? [] : [keyNames[binding.secondCode] ?? binding.secondCode.replace(/^(Key|Digit)/u, "")];
	const keys = [...binding.modifiers.map((value) => symbols[value]), key];
	return {
		keys: [...platform === "windows" ? keys.flatMap((label, index) => index === 0 ? [label] : ["+", label]) : keys, ...second],
		aria: binding.secondCode === void 0 ? [...binding.modifiers.map((value) => ariaNames[value]), ariaKey].join("+") : void 0
	};
}
/**
* Check Web combinations: Windows and macOS also admit any three or four modifiers; Linux retains the limited set.
* @param binding - normalized candidate.
* @param platform - receiving device platform.
* @returns whether this combination is admitted; admission does not guarantee browser or system delivery.
*/
function isWebBindingAllowed(binding, platform) {
	if (binding.secondCode !== void 0) return false;
	if (platform === "windows" || platform === "macos") {
		if (binding.modifiers.length >= 3) return true;
		const primary = platform === "macos" ? "meta" : "control";
		if (binding.modifiers.length === 1 && (["Comma", "Backslash"].includes(binding.code) && binding.modifiers[0] === primary || binding.code === "Backquote" && binding.modifiers[0] === "control")) return true;
		if (binding.modifiers.length === 2 && binding.modifiers.includes(primary) && (binding.modifiers.includes("alt") || binding.modifiers.includes("shift"))) return true;
	}
	return [
		{
			code: "Slash",
			modifiers: ["primary"]
		},
		{
			code: "Comma",
			modifiers: ["primary", "shift"]
		},
		{
			code: "Period",
			modifiers: ["primary", "shift"]
		}
	].some((candidate) => bindingKey(binding) === bindingKey(normalizeBinding(candidate, platform)));
}
//#endregion
//#region lib/types/configuration.js
/** Validated preference documents and deterministic conflict resolution, without browser dependencies. */
const record = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
const commandPattern = /^[a-z][a-zA-Z0-9-]*(?:\.[a-zA-Z][a-zA-Z0-9-]*)+$/u;
/**
* Validate JSON binding fields before normalization; unknown fields are rejected to prevent lossy rewrites.
* @param value - file or IPC input.
* @returns a binding with a supported physical code, or null for explicit removal.
*/
function parseBinding(value) {
	if (value === null) return null;
	if (!record(value) || Object.keys(value).some((key) => key !== "code" && key !== "secondCode" && key !== "modifiers") || typeof value.code !== "string" || !Array.isArray(value.modifiers) || Object.hasOwn(value, "secondCode") && typeof value.secondCode !== "string" || !value.modifiers.every((modifier) => typeof modifier === "string" && [
		"primary",
		"control",
		"alt",
		"shift",
		"meta"
	].includes(modifier))) throw new Error("Invalid shortcut binding");
	const binding = {
		code: value.code,
		modifiers: value.modifiers,
		...typeof value.secondCode === "string" ? { secondCode: value.secondCode } : {}
	};
	normalizeBinding(binding, "windows");
	return binding;
}
/**
* Decode the complete document while preserving dormant command overrides.
* @param raw - stored JSON, or null for a missing document.
* @returns the accepted document or a classified read failure.
*/
function parseShortcutDocument(raw) {
	if (raw === null) return {
		schemaVersion: 1,
		profiles: {}
	};
	try {
		const value = JSON.parse(raw);
		if (!record(value)) return "invalid";
		if (typeof value.schemaVersion === "number" && value.schemaVersion > 2) return "future";
		if (value.schemaVersion !== 1 && value.schemaVersion !== 2 || !record(value.profiles) || Object.keys(value).some((key) => key !== "schemaVersion" && key !== "profiles")) return "invalid";
		const profiles = {};
		for (const [profile, overrides] of Object.entries(value.profiles)) {
			if (!/^(desktop|web):(macos|windows|linux)$/u.test(profile) || !record(overrides)) return "invalid";
			const bindings = {};
			for (const [id, binding] of Object.entries(overrides)) {
				if (!commandPattern.test(id)) return "invalid";
				const parsed = parseBinding(binding);
				if (value.schemaVersion === 1 && parsed?.secondCode !== void 0) return "invalid";
				bindings[id] = parsed;
			}
			profiles[profile] = bindings;
		}
		return {
			schemaVersion: value.schemaVersion,
			profiles
		};
	} catch (_error) {
		return "invalid";
	}
}
/**
* Check system, editor, and browser reservations using expanded physical modifiers.
* @param binding - normalized candidate.
* @param runtime - receiving application shell.
* @param platform - receiving device.
* @returns the rejection reason, or null when this combination is allowed.
*/
function bindingIssue(binding, runtime, platform) {
	const { code, modifiers } = binding;
	if (runtime === "desktop" && (platform === "windows" || platform === "macos")) return null;
	if (binding.secondCode !== void 0) return "unsupported-key";
	if (modifiers.length === 0 || modifiers.every((modifier) => modifier === "shift")) return "modifier-required";
	if ((platform === "windows" || platform === "macos") && modifiers.length >= 3) return null;
	if (runtime === "web" && (platform === "windows" || platform === "macos") && isWebBindingAllowed(binding, platform)) return null;
	const primary = modifiers.includes(platform === "macos" ? "meta" : "control");
	if ([
		"Escape",
		"Tab",
		"Space",
		"Backspace",
		"Delete",
		"ArrowUp",
		"ArrowDown",
		"ArrowLeft",
		"ArrowRight"
	].includes(code) || code === "Enter" && !modifiers.includes("alt") || primary && [
		"KeyC",
		"KeyV",
		"KeyX",
		"KeyZ",
		"KeyY",
		"KeyQ",
		"KeyH"
	].includes(code) || primary && code === "KeyA" && !modifiers.includes("shift") || platform !== "macos" && (modifiers.includes("meta") || modifiers.includes("alt") && ["F4", "F2"].includes(code)) || platform === "macos" && modifiers.includes("control") && modifiers.includes("meta") || platform === "macos" && modifiers.includes("alt") && !primary) return "reserved";
	if (runtime === "web" && !isWebBindingAllowed(binding, platform)) return "unsupported-browser";
	return null;
}
/**
* Select the command owner's explicit default for one device profile.
* @param definition - command identity and per-profile defaults.
* @param runtime - receiving shell.
* @param platform - receiving device.
* @returns the declared physical binding, or undefined for an unbound action.
*/
function resolveShortcutDefault(definition, runtime, platform) {
	return definition.defaults[`${runtime}:${platform}`];
}
/**
* Resolve overrides and conflicts independently of registration order. Explicit overrides displace defaults.
* @param definitions - active commands.
* @param document - accepted preferences.
* @param runtime - receiving shell.
* @param platform - receiving device.
* @returns every active command, including unavailable conflicting bindings.
*/
function effectiveShortcuts(definitions, document, runtime, platform) {
	const overrides = document.profiles[`${runtime}:${platform}`] ?? {};
	const fixed = definitions.flatMap((row) => row.fixed?.map((binding) => ({
		id: row.id,
		binding: normalizeBinding(binding, platform)
	})) ?? []);
	const rows = definitions.filter((row) => row.fixed === void 0).map(({ id, defaults }) => {
		const modified = Object.hasOwn(overrides, id);
		const candidate = modified ? overrides[id] : resolveShortcutDefault({
			id,
			defaults
		}, runtime, platform);
		const binding = candidate == null ? null : normalizeBinding(candidate, platform);
		return {
			id,
			binding,
			modified,
			issue: binding === null ? null : bindingIssue(binding, runtime, platform)
		};
	});
	return rows.map((row) => {
		const binding = row.binding;
		return {
			...row,
			conflicts: binding === null ? [] : [...new Set([...rows.filter((other) => other.id !== row.id && other.binding !== null && other.issue === null && overlappingBindings(other.binding, binding) && (!row.modified || other.modified)).map((other) => other.id), ...fixed.filter((other) => overlappingBindings(other.binding, binding)).map((other) => other.id)])]
		};
	});
}
/**
* Detect identical combinations or a single key contained in a two-key chord.
* @param left - normalized candidate.
* @param right - normalized occupied binding.
* @returns whether both bindings require the same modifiers and overlap.
*/
function overlappingBindings(left, right) {
	if (left.modifiers.join("+") !== right.modifiers.join("+")) return false;
	if (left.secondCode !== void 0 && right.secondCode !== void 0) return bindingKey(left) === bindingKey(right);
	return [left.code, left.secondCode].some((code) => code !== void 0 && (code === right.code || code === right.secondCode));
}
/**
* Apply an edit without modifying other profiles or dormant overrides.
* @param document - accepted document.
* @param edit - validated operation.
* @param runtime - current shell.
* @param platform - current device.
* @returns the candidate document, pending conflict checks and durable storage.
*/
function editShortcutDocument(document, edit, runtime, platform) {
	const schemaVersion = runtime === "desktop" && (platform === "macos" || platform === "windows") ? 2 : document.schemaVersion;
	const profile = `${runtime}:${platform}`;
	let overrides = { ...document.profiles[profile] };
	switch (edit.type) {
		case "set":
			overrides[edit.id] = edit.binding;
			break;
		case "reset": {
			const { [edit.id]: _removed, ...remaining } = overrides;
			overrides = remaining;
			break;
		}
		case "reset-all":
			overrides = {};
			break;
		/* v8 ignore next -- parseShortcutEdit validates this closed union before persistence. */
		default: return assertNever(edit, "shortcut edit");
	}
	return {
		schemaVersion,
		profiles: {
			...document.profiles,
			[profile]: overrides
		}
	};
}
/**
* Validate a preference edit at the Desktop IPC boundary.
* @param value - untrusted renderer request.
* @returns the constrained operation; malformed requests throw.
*/
function parseShortcutEdit(value) {
	if (!record(value)) throw new Error("Invalid shortcut edit");
	if (value.type === "reset-all" && Object.keys(value).length === 1) return { type: value.type };
	if (typeof value.id !== "string" || !commandPattern.test(value.id)) throw new Error("Invalid shortcut command");
	if (value.type === "reset" && Object.keys(value).length === 2) return {
		type: "reset",
		id: value.id
	};
	if (value.type === "set" && Object.keys(value).length === 3) return {
		type: "set",
		id: value.id,
		binding: parseBinding(value.binding)
	};
	throw new Error("Invalid shortcut edit");
}
/**
* Validate the trusted product's serializable command catalog at IPC ingress.
* @param value - renderer-supplied active command definitions.
* @returns validated definitions; duplicate IDs, overlapping defaults, and unsupported combinations throw.
*/
function parseShortcutDefinitions(value) {
	if (!Array.isArray(value)) throw new Error("Invalid shortcut catalog");
	const ids = /* @__PURE__ */ new Set();
	for (const entry of value) {
		if (!record(entry) || typeof entry.id !== "string" || !commandPattern.test(entry.id) || ids.has(entry.id) || !record(entry.defaults) || Object.keys(entry).some((key) => key !== "id" && key !== "defaults" && key !== "fixed")) throw new Error("Invalid shortcut definition");
		ids.add(entry.id);
		if (Object.hasOwn(entry, "fixed")) {
			if (!Array.isArray(entry.fixed) || entry.fixed.length === 0 || Object.keys(entry.defaults).length > 0) throw new Error("Invalid fixed shortcut definition");
			for (const binding of entry.fixed) if (parseBinding(binding) === null) throw new Error("Invalid fixed shortcut binding");
		}
		for (const [profile, candidate] of Object.entries(entry.defaults)) {
			if (!/^(desktop|web):(macos|windows|linux)$/u.test(profile)) throw new Error("Invalid shortcut profile");
			if (parseBinding(candidate) === null) throw new Error("Invalid shortcut default");
		}
	}
	const definitions = value;
	for (const runtime of ["desktop", "web"]) for (const platform of [
		"macos",
		"windows",
		"linux"
	]) {
		const bindings = [];
		for (const entry of definitions) {
			const binding = resolveShortcutDefault(entry, runtime, platform);
			if (binding === void 0) continue;
			const normalized = normalizeBinding(binding, platform);
			if (bindings.some((other) => overlappingBindings(other, normalized)) || bindingIssue(normalized, runtime, platform) !== null) throw new Error("Conflicting or reserved shortcut default");
			bindings.push(normalized);
		}
	}
	return definitions;
}
//#endregion
//#region lib/types/persistence.js
/** Serialized preference transactions; storage owners publish only accepted writes or read diagnostics. */
/**
* Create a disabled initial snapshot for asynchronous adapter startup.
* @returns a fresh configuration with no accepted persisted state.
*/
function initialShortcutConfig() {
	return {
		revision: randomUUID(),
		sequence: 0,
		document: {
			schemaVersion: 1,
			profiles: {}
		},
		status: "loading",
		error: null,
		usingDefaults: true
	};
}
/** Single-writer coordinator shared by localStorage and Electron's atomic file adapter. */
var ShortcutPersistence = class {
	storage;
	runtime;
	platform;
	rereadBeforeWrite;
	publish;
	snapshot = initialShortcutConfig();
	raw;
	queue = Promise.resolve();
	definitions = null;
	active = true;
	constructor(storage, runtime, platform, rereadBeforeWrite, publish) {
		this.storage = storage;
		this.runtime = runtime;
		this.platform = platform;
		this.rereadBeforeWrite = rereadBeforeWrite;
		this.publish = publish;
	}
	/**
	* Install or revoke a product catalog and invalidate drafts from its previous lifetime.
	* @param definitions - current trusted definitions, or null while the product is not ready.
	*/
	setDefinitions(definitions) {
		this.definitions = definitions;
		this.accept({ ...this.snapshot });
	}
	/** Stop accepting edits or publishing late completions. */
	dispose() {
		this.active = false;
	}
	/**
	* Read the current file; failures retain the last accepted document and disable ordinary writes.
	* @returns the accepted snapshot or diagnostic snapshot.
	*/
	readCurrent() {
		return this.serialize(() => this.read());
	}
	/**
	* Compare the draft revision, validate the complete candidate, then persist before publishing.
	* @param edit - constrained preference operation.
	* @param revision - state against which the user reviewed the edit.
	* @returns a classified outcome and the currently accepted snapshot.
	*/
	edit(edit, revision) {
		return this.serialize(async () => {
			if (this.rereadBeforeWrite) await this.read();
			const result = (status) => ({
				status,
				snapshot: this.snapshot
			});
			if (!this.active || this.definitions === null || this.snapshot.status === "loading") return result("not-ready");
			if (revision !== this.snapshot.revision) return result("stale");
			if (this.snapshot.status === "unreadable") return result("unreadable");
			if ((edit.type === "set" || edit.type === "reset") && !this.definitions.some((row) => row.id === edit.id && row.fixed === void 0)) return result("not-ready");
			const document = editShortcutDocument(this.snapshot.document, edit, this.runtime, this.platform);
			const rows = effectiveShortcuts(this.definitions, document, this.runtime, this.platform);
			const invalid = rows.find((row) => (edit.type === "reset-all" || row.id === edit.id) && (row.issue !== null || row.conflicts.length > 0));
			const displaced = edit.type === "set" ? rows.find((row) => row.conflicts.includes(edit.id)) : void 0;
			if (invalid !== void 0 || displaced !== void 0) return {
				...result("conflict"),
				...invalid?.issue ? { issue: invalid.issue } : {},
				conflicts: invalid?.conflicts.length ? invalid.conflicts : displaced === void 0 ? [] : [displaced.id]
			};
			try {
				const raw = `${JSON.stringify(document, null, 2)}\n`;
				await this.storage.write(raw);
				this.raw = raw;
				this.accept({
					...this.snapshot,
					document,
					status: "ready",
					error: null,
					usingDefaults: false
				});
				return result("saved");
			} catch (_error) {
				return result("write-failed");
			}
		});
	}
	serialize(operation) {
		const next = this.queue.then(operation);
		this.queue = next.catch(() => void 0);
		return next;
	}
	accept(snapshot) {
		this.snapshot = {
			...snapshot,
			sequence: this.snapshot.sequence + 1,
			revision: randomUUID()
		};
		if (!this.active) return;
		try {
			this.publish(this.snapshot);
		} catch (error) {
			console.error("Shortcut configuration subscriber failed:", error);
		}
	}
	async read() {
		let raw;
		try {
			raw = await this.storage.read();
		} catch (_error) {
			if (this.snapshot.error !== "read") this.accept({
				...this.snapshot,
				status: "unreadable",
				error: "read"
			});
			return this.snapshot;
		}
		if (raw === this.raw && this.snapshot.error !== "read") return this.snapshot;
		this.raw = raw;
		const document = parseShortcutDocument(raw);
		if (typeof document === "string") this.accept({
			...this.snapshot,
			status: "unreadable",
			error: document
		});
		else this.accept({
			...this.snapshot,
			document,
			status: "ready",
			error: null,
			usingDefaults: raw === null
		});
		return this.snapshot;
	}
};
//#endregion
//#region lib/types/policy.js
/** Explicit desktop input-arbitration policy shared by the DOM dispatcher, native adapter, and shell. */
/**
* Deployment-selected policy mark on the product document. The trusted shell
* preload sets `data-shortcut-policy="local-first"`; absence keeps
* `native-priority`, so upstream Desktop behaviour is unchanged.
*/
const SHORTCUT_POLICY_ATTRIBUTE = "shortcutPolicy";
/**
* Chords whose local semantics a bound command may not steal, under the
* local-first policy: copy/close stay with editable and terminal controls even
* when the user bound the same key to an application command.
* @param gesture - physical-key facts at dispatch.
* @param context - synchronous input and modal owner.
* @returns whether the event must pass through to the local control.
*/
function localFirstProtected(gesture, context) {
	if (context.region !== "editable" && context.region !== "terminal") return false;
	return gesture.control && !gesture.meta && !gesture.alt && !gesture.shift && gesture.secondCode === void 0 && (gesture.code === "KeyC" || gesture.code === "KeyW");
}
//#endregion
export { SHORTCUT_POLICY_ATTRIBUTE, ShortcutPersistence, bindingIssue, bindingKey, editShortcutDocument, effectiveShortcuts, initialShortcutConfig, isWebBindingAllowed, localFirstProtected, normalizeBinding, overlappingBindings, parseBinding, parseShortcutDefinitions, parseShortcutDocument, parseShortcutEdit, presentBinding, resolveShortcutDefault };
