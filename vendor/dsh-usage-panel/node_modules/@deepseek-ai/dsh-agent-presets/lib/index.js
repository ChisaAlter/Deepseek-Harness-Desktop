import { chmod, cp, readFile, readdir, rm, stat } from "node:fs/promises";
import { Context, Service } from "@deepseek-ai/cordis";
import z from "@deepseek-ai/schemastery";
import { bindScopeParent, createScope, scopeOf, scopeParentOf } from "@deepseek-ai/dsh-scope";
import { settingsNamespace } from "@deepseek-ai/dsh-settings";
import { dshHomePath, expandHomePath } from "@deepseek-ai/dsh-home-paths";
import { dirname, isAbsolute, join, resolve } from "node:path";
import yaml, { load } from "js-yaml";
import { Include, entryListSchema } from "@deepseek-ai/cordis-plugin-include";
import { writeFileAtomic } from "@deepseek-ai/dsh-atomic-write";
import { pathToFileURL } from "node:url";
//#region lib/types/metadata.js
/**
* A preset's display metadata: the name and description a picker shows.
*
* It lives in its own file because the composition is a top-level list of
* plugin rows — YAML cannot carry sibling keys beside it, and faking a
* metadata row would hand the Loader something to load. Keeping it separate
* also keeps the composition exactly what its name says: a Cordis file the
* loader owns and the cordis preset can author.
*
* The file carries display text ONLY. `id` is the directory name and `trust`
* comes from the root a preset was discovered under, so neither is writable
* here — otherwise a locally authored preset could claim to be a shipped one.
*
* Every read failure degrades to no metadata. A preset whose display text is
* missing, malformed, or unreadable still mounts: presentation is not a
* capability, and a broken name must never become an agent that cannot start.
* @module @deepseek-ai/dsh-agent-presets/metadata
*/
/** The optional display-metadata file beside a preset's composition. */
const METADATA_FILE = "preset.yml";
/** A non-empty trimmed string, or undefined for anything else. */
function text(value) {
	if (typeof value !== "string") return void 0;
	const trimmed = value.trim();
	return trimmed === "" ? void 0 : trimmed;
}
/**
* Read one preset directory's display metadata.
*
* Absent, unparsable, and wrongly-shaped files are all the same answer —
* empty metadata — because the caller renders a picker, not a diagnostic.
* @param directory - the preset directory.
* @returns the display text the preset published, possibly empty.
*/
async function readPresetMetadata(directory) {
	let raw;
	try {
		raw = await readFile(join(directory, METADATA_FILE), "utf8");
	} catch {
		return {};
	}
	let parsed;
	try {
		parsed = yaml.load(raw);
	} catch {
		return {};
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
	const record = parsed;
	const name = text(record.name);
	const description = text(record.description);
	const order = typeof record.order === "number" && Number.isFinite(record.order) ? record.order : void 0;
	return {
		...name === void 0 ? {} : { name },
		...description === void 0 ? {} : { description },
		...order === void 0 ? {} : { order }
	};
}
/**
* Render display metadata as the file's contents.
*
* Absent fields are omitted rather than written empty, so a preset with no
* description does not ship a key that reads as an intentional blank.
* @param metadata - the display text to store.
* @returns the YAML document, or undefined when there is nothing to store.
*/
function renderPresetMetadata(metadata) {
	const name = text(metadata.name);
	const description = text(metadata.description);
	const { order } = metadata;
	if (name === void 0 && description === void 0 && order === void 0) return void 0;
	return yaml.dump({
		...name === void 0 ? {} : { name },
		...description === void 0 ? {} : { description },
		...order === void 0 ? {} : { order }
	}, { lineWidth: -1 });
}
//#endregion
//#region lib/types/preset.js
/** Agent-preset vocabulary shared by discovery, mounting, and consumers. */
/**
* Ids a preset directory may use.
*
* The id becomes a path segment, so this is a containment boundary rather than
* a style rule: `..`, a separator, or an absolute-looking name would place the
* composition outside the root the deployment authorised. Discovery shares it:
* a directory whose name no copy could ever claim is not a preset slot.
*/
const PRESET_ID = /^[a-z0-9][a-z0-9-]*$/;
/**
* No configured root supplies the requested preset.
*
* Separate from a mount failure because the two mean different things to a
* caller: an unknown id is a bad request, while an unusable composition is a
* broken preset the deployment must fix.
*/
var UnknownPresetError = class extends Error {
	presetId;
	available;
	constructor(presetId, available) {
		super(`agent-presets: preset "${presetId}" not found (available: ${available.join(", ") || "none"})`);
		this.presetId = presetId;
		this.available = available;
	}
};
/** A preset exists but its composition cannot be installed. */
var PresetMountError = class extends Error {
	presetId;
	reason;
	constructor(presetId, reason, options) {
		super(`agent-presets: preset "${presetId}" failed to mount: ${reason}`, options);
		this.presetId = presetId;
		this.reason = reason;
	}
};
//#endregion
//#region lib/types/discovery.js
/**
* Filesystem discovery of agent presets. A preset is a directory holding
* {@link COMPOSITION_FILE}, optionally beside a {@link METADATA_FILE} carrying
* its display text; the directory name is the preset id. Discovery
* re-reads the roots on every call so a preset authored while the process is
* running is visible without a restart.
*
* Discovery also owns preset HEALTH: a directory whose composition is
* missing or unloadable is reported as a broken roster row rather than
* skipped. A skipped directory would still occupy its id on disk — the copy
* path refuses the name while no surface shows anything to delete — and a
* malformed composition would otherwise read as an ordinary preset until the
* first session fails to mount it.
* @module @deepseek-ai/dsh-agent-presets/discovery
*/
/** The composition file that makes a directory a preset. */
const COMPOSITION_FILE = "agent.cordis.yml";
/**
* Harness-home directory holding locally authored presets.
*
* This package owns the writable root the way `dsh-skill-filesystem` owns
* `<dshHome>/skills`. An app must assemble the SHIPPED root, whose path only
* the installed app can resolve; where a person's own presets go is the same
* place in every deployment that does not say otherwise, so a launcher that
* forgets to configure one still finds them.
*
* Package-internal on purpose: no consumer outside this package addresses the
* directory by name, and a test that imported it could not catch this value
* being wrong — the expected segment is spelled out where it is asserted.
*/
const USER_PRESET_DIR = ".agent-presets";
/**
* Why `rows` cannot be an entry list, or undefined when it can.
*
* A shallow shape check, deliberately short of the loader's work: it does not
* resolve plugin names or apply configs. What it catches is the hand-edit
* that produces a file the loader cannot even begin with — and it must accept
* everything the loader accepts, which is why rows are only required to be
* maps carrying a plugin `name` (groups recurse into their own lists).
* @param rows - the parsed composition document.
* @param at - row-path prefix for nested diagnostics, empty at the top level.
* @returns one human-readable reason, or undefined when the shape holds.
*/
function entryListProblem(rows, at = "") {
	if (!Array.isArray(rows)) return at === "" ? "the composition must be a top-level list of plugin rows" : `group ${at} must hold a list of plugin rows`;
	for (const [index, row] of rows.entries()) {
		const label = at === "" ? `row ${String(index + 1)}` : `${at} row ${String(index + 1)}`;
		if (typeof row !== "object" || row === null || Array.isArray(row)) return `${label} is not a plugin row (expected a map with a "name")`;
		const { name, group, config } = row;
		if (typeof name !== "string" || name === "") return `${label} names no plugin (a "name" string is required)`;
		if (group === true) {
			const nested = entryListProblem(config, label);
			if (nested !== void 0) return nested;
		}
	}
}
/**
* Why the composition at `path` cannot mount, or undefined when it looks
* loadable. Parsed with the loader's own YAML dialect ({@link entryListSchema},
* the one carrying `!!js`), so health can never call a composition broken
* that the loader would accept.
* @param path - absolute path of the composition file.
* @returns one human-readable reason, or undefined when the file is loadable.
*/
async function compositionProblem(path) {
	let content;
	try {
		content = await readFile(path, "utf8");
	} catch {
		return `the composition file ${COMPOSITION_FILE} cannot be read`;
	}
	let rows;
	try {
		rows = load(content, { schema: entryListSchema });
	} catch (error) {
		return `the composition is not valid YAML: ${(error instanceof Error ? error.message : String(error)).replace(/\n[\s\S]*$/, "")}`;
	}
	return entryListProblem(rows);
}
/**
* Whether `path` names an existing regular file.
* @param path - absolute path to test.
* @returns true when the path resolves to a file.
*/
async function isFile(path) {
	try {
		return (await stat(path)).isFile();
	} catch {
		return false;
	}
}
/**
* Scan one root for preset directories.
*
* An absent root yields no presets rather than throwing: the user root does
* not exist until the first locally authored preset, and naming a default
* that no root supplies already fails loud at resolution.
*
* Every directory whose name is a usable preset id is a roster row — broken
* when its composition is missing or unloadable. A directory named outside
* {@link PRESET_ID} is skipped instead: no copy could ever claim that name,
* so it blocks nothing, and reporting `.DS_Store`-grade residue as broken
* presets would teach users to ignore the marker.
* @param root - the directory and the trust its presets inherit.
* @returns the root's presets ordered by id.
*/
async function scanRoot(root) {
	const dir = resolve(expandHomePath(root.path));
	let children;
	try {
		children = await readdir(dir, { withFileTypes: true });
	} catch (error) {
		if (error.code === "ENOENT") return [];
		throw new Error(`agent-presets: cannot read preset root ${dir}: ${String(error)}`, { cause: error });
	}
	const found = [];
	for (const child of children) {
		if (!child.isDirectory() || !PRESET_ID.test(child.name)) continue;
		const directory = join(dir, child.name);
		const path = join(directory, COMPOSITION_FILE);
		const broken = await isFile(path) ? await compositionProblem(path) : `the composition file ${COMPOSITION_FILE} is missing — the directory still occupies the id; delete it or restore the file`;
		const metadata = await readPresetMetadata(directory);
		found.push({
			id: child.name,
			trust: root.trust,
			path,
			...metadata,
			...broken === void 0 ? {} : { broken }
		});
	}
	return found.sort((left, right) => {
		const byOrder = (left.order ?? Number.POSITIVE_INFINITY) - (right.order ?? Number.POSITIVE_INFINITY);
		return byOrder === 0 ? left.id.localeCompare(right.id) : byOrder;
	});
}
/**
* Scan every root in precedence order.
* @param roots - roots in precedence order; an earlier root wins a duplicate id.
* @returns every discovered preset, first-root-wins per id.
*/
async function discoverPresets(roots) {
	const byId = /* @__PURE__ */ new Map();
	for (const root of roots) for (const preset of await scanRoot(root)) {
		if (byId.has(preset.id)) continue;
		byId.set(preset.id, preset);
	}
	return [...byId.values()];
}
//#endregion
//#region lib/types/authoring.js
/**
* Copying, reading, and deleting locally authored presets.
*
* Authoring is confined to a `user` root: the shipped `.system` set is part of
* the deployment, and letting a browser rewrite it would turn "reset to a known
* preset" into something the same caller could have broken first.
*
* The only authoring write is a whole-directory copy of an existing preset.
* No caller supplies composition text: the inputs are ids the host resolves
* against its own roots plus an optional display name, so authoring grants no
* capability the copied preset did not already carry.
* @module @deepseek-ai/dsh-agent-presets/authoring
*/
/** A preset id that cannot be used as a directory name under a root. */
var InvalidPresetIdError = class extends Error {
	presetId;
	constructor(presetId) {
		super(`agent-presets: preset id ${JSON.stringify(presetId)} must match ${String(PRESET_ID)} — the id is a directory name, so anything else could escape the preset root`);
		this.presetId = presetId;
	}
};
/** A copy target that is already occupied — a copy never overwrites. */
var PresetExistsError = class extends Error {
	presetId;
	constructor(presetId) {
		super(`agent-presets: preset "${presetId}" already exists — a copy never overwrites; delete the existing preset first or choose another id`);
		this.presetId = presetId;
	}
};
/** Authoring was attempted where the deployment allows none. */
var PresetNotWritableError = class extends Error {
	presetId;
	constructor(presetId, reason) {
		super(`agent-presets: preset "${presetId}" cannot be written: ${reason}`);
		this.presetId = presetId;
	}
};
/**
* The root locally authored presets are written to.
* @param roots - the configured roots in precedence order.
* @returns the absolute path of the first `user` root.
* @throws when the deployment configured no writable root.
*/
function writableRoot(roots) {
	const root = roots.find((candidate) => candidate.trust === "user");
	if (root === void 0) throw new PresetNotWritableError("", "this deployment configures no user-writable preset root");
	return resolve(expandHomePath(root.path));
}
/**
* Read one preset's composition text.
* @param preset - the resolved preset.
* @returns the file's contents.
*/
async function readComposition(preset) {
	return await readFile(preset.path, "utf8");
}
/** Whether anything occupies the path (cp's own errorOnExist backstops races). */
async function occupied(path) {
	let present = true;
	try {
		await stat(path);
	} catch {
		present = false;
	}
	return present;
}
/**
* Re-tighten a copied tree to owner-only. A shipped preset is world-readable
* in its install and `cp` preserves that; the copy carries the same weight as
* the settings document beside it, so group/other access is stripped. A
* file's owner-execute bit survives — a preset may ship runnable helpers.
*/
async function tightenModes(dir) {
	await chmod(dir, 448);
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		const target = join(dir, entry.name);
		if (entry.isDirectory()) await tightenModes(target);
		else
 /* v8 ignore next -- Windows exposes no POSIX owner-execute bit; the POSIX lane covers both file modes. */
		await chmod(target, ((await stat(target)).mode & 64) === 0 ? 384 : 448);
	}
}
/**
* Create a preset by copying an existing one's whole directory.
*
* The copy carries everything the source directory holds — composition,
* metadata, skill directories, assets — because a preset is its directory,
* not one file. Symlinks are dereferenced so the copy is self-contained
* rather than a set of links back into the install it was copied from.
*
* The copied metadata is then rewritten: the source's description is kept
* (the file is the author's to edit afterwards), but its name and roster
* `order` are not — a copy presenting itself identically to its source, or
* sorted into the shipped set's declared order, would make the roster stop
* distinguishing them. With no name given and no description to keep, the
* file is removed so the copy publishes nothing rather than a blank.
* @param roots - the configured roots; the first `user` one receives the copy.
* @param source - the resolved preset the copy starts from.
* @param id - the new preset's id, which becomes its directory name.
* @param name - display name for the copy; omitted falls back to the id.
* @returns the absolute path of the new preset directory.
* @throws when the id is unusable or already occupied on disk, or the
* deployment configures no writable root.
*/
async function copyComposition(roots, source, id, name) {
	if (!PRESET_ID.test(id)) throw new InvalidPresetIdError(id);
	const dir = join(writableRoot(roots), id);
	if (await occupied(dir)) throw new PresetExistsError(id);
	try {
		await cp(dirname(source.path), dir, {
			recursive: true,
			dereference: true,
			force: false,
			errorOnExist: true
		});
		await tightenModes(dir);
		const rendered = renderPresetMetadata({
			...name === void 0 ? {} : { name },
			...source.description === void 0 ? {} : { description: source.description }
		});
		const metadataPath = join(dir, METADATA_FILE);
		if (rendered === void 0) await rm(metadataPath, { force: true });
		else await writeFileAtomic(metadataPath, rendered, {
			mode: 384,
			dirMode: 448
		});
	} catch (error) {
		await rm(dir, {
			recursive: true,
			force: true
		});
		throw error;
	}
	return dir;
}
/**
* Delete a locally authored preset.
*
* A shipped preset is refused: it belongs to the deployment. A preset a live
* session mounted is NOT refused — the composition was read at creation and is
* never re-read, so that session keeps running exactly as it was.
* @param roots - the configured roots.
* @param preset - the resolved preset to remove.
* @throws when the preset ships with the deployment or lies outside the writable root.
*/
async function deleteComposition(roots, preset) {
	if (preset.trust !== "user") throw new PresetNotWritableError(preset.id, "it ships with the deployment");
	const dir = join(writableRoot(roots), preset.id);
	if (!isAbsolute(preset.path) || !preset.path.startsWith(dir)) throw new PresetNotWritableError(preset.id, "it does not live under the writable preset root");
	await rm(dir, {
		recursive: true,
		force: true
	});
}
//#endregion
//#region lib/types/mount.js
/**
* Mount one preset composition under an agent's scope context, then prove the
* result is usable before the agent is published.
*
* The scope context is what makes the composition per-session: entry contexts
* chain to the context the subtree was plugged into, so every `ctx.tools`
* and `ctx.systemPrompt` registration inside the preset files into that
* agent's layer and unwinds with it. Two guards make that safe. A row that
* never reached a usable state is rejected, because a directly-plugged subtree
* is absent from `ctx.loader.entries()` and no boot audit covers it. A row that
* published a service into the ROOT realm is rejected, because such a service
* is process-global rather than per-session and the second session mounting the
* same preset collides with the first.
* @module @deepseek-ai/dsh-agent-presets/mount
*/
/**
* Subtrees captured by config identity. A subtree plugged directly (rather than
* created as a loader entry) never links itself to an `Entry`, so this is the
* only handle to the rows it created; config objects are minted per mount, so
* concurrent mounts cannot collide.
*/
const mounted = /* @__PURE__ */ new WeakMap();
/**
* The base URL bare specifiers resolve against, per pending mount, keyed by the
* same config object. Recorded before the subtree is plugged, because `Include`
* rewrites its own context's `baseUrl` to the composition's directory and the
* pre-mount value is the only handle on where the harness itself lives.
*/
const harnessBase = /* @__PURE__ */ new WeakMap();
/**
* Include subclass that publishes its tree and fiber for the audit, and never
* writes to the file it read.
*/
var PresetTree = class extends Include {
	constructor(ctx, config) {
		super(ctx, config);
		mounted.set(config, {
			tree: this,
			fiber: ctx.fiber
		});
	}
	/**
	* Resolve a bare specifier from the harness rather than from the preset.
	*
	* `EntryTree.import()` resolves against the tree's own `baseUrl`, which
	* `Include` sets to the composition's directory. That is right for a
	* relative specifier — a preset's own files travel with it — and wrong for
	* a package name: a locally authored preset lives under the user's home,
	* where Node's upward `node_modules` walk never reaches the harness's own
	* dependencies, so every `@deepseek-ai/dsh-*` row would fail to import. The
	* mount records the host composition's base instead, which is inside the
	* installed harness, and bare names resolve from there. An absolute
	* filesystem path names neither base and becomes a file URL before Node's
	* ESM loader receives it, which is required for drive-letter paths on
	* Windows.
	* @param name - the module specifier from the row.
	* @param getOuterStack - the loader's stack composer for import diagnostics.
	* @returns the imported module, or the `cordis:` builtin.
	*/
	import(name, getOuterStack) {
		const specifier = isAbsolute(name) ? pathToFileURL(name).href : name;
		const base = harnessBase.get(this.config);
		/* v8 ignore next -- every PresetTree is constructed by `mountPreset`, which records the base first */
		if (base === void 0) return super.import(specifier, getOuterStack);
		if (name.startsWith(".") || name.startsWith("cordis:")) return super.import(name, getOuterStack);
		const internal = this.ctx.loader.internal;
		/* v8 ignore next -- Node always supplies the internal module loader; the branch keeps a
		hypothetical embedder from losing the row's name in a resolution error. */
		if (internal === void 0) return super.import(specifier, getOuterStack);
		return internal.import(specifier, base, {});
	}
	/**
	* A preset is an input, never a persistence target.
	*
	* The Loader writes a tree back through this method whenever it decides the
	* config changed — a plugin self-disposing is enough, and tearing an agent
	* down disposes its whole subtree. Inherited, that rewrites the preset file
	* with whatever the dying tree held, which in practice means truncating a
	* shipped composition to `[]` the first time a session ends. Persisting a
	* preset is also meaningless: nothing here is user state, and the same file
	* backs every session that names it.
	*
	* Dropping the write drops the `loader/config-update` the inherited method
	* emits with it. Nothing observes one for a preset subtree today, and a
	* future "edit your preset while it runs" flow needs a deliberate
	* persistence path rather than this method's return.
	*/
	write() {}
};
const mounts = /* @__PURE__ */ new Set();
/**
* Drop every record whose subtree is gone.
*
* Records are pruned by observation rather than through a disposal hook
* because a subtree can be torn down by its owning agent, by a failed mount, or
* by the whole tree unloading, and a cleared `uid` is what all three share.
*
* Pruning therefore has to happen on a path this module owns. Reading is one
* such path, but not a reliable one: the only production reader is the
* invariant companion's service listener, and `dsh-invariants` is a
* development composition — a shipped host never loads it. Mounting is the
* other, and it is the one every session takes, which bounds the set at one
* generation of dead records rather than one per session ever composed. Each
* record would otherwise retain its whole disposed subtree: the fiber holds
* its config, and that config is the key its `EntryTree` is stored under.
*/
function pruneDisposedMounts() {
	for (const mount of mounts) if (mount.fiber.uid === null) mounts.delete(mount);
}
/**
* Every preset composition still installed, pruning fibers disposed since the
* last read.
* @returns the live mounts.
*/
function livePresetMounts() {
	pruneDisposedMounts();
	return [...mounts];
}
/**
* Whether `fiber` is `root` itself or is mounted anywhere inside its subtree.
*
* Membership is object identity. `uid` looks like a cheaper key but is a
* per-registry counter, so fibers in two different roots collide on it and a
* subtree in one runtime would be blamed for a service published in another.
* @param fiber - the fiber to locate.
* @param root - the subtree root to test membership against.
* @returns true when `fiber` belongs to `root`'s subtree.
*/
function withinFiber(fiber, root) {
	let current = fiber;
	while (true) {
		if (current === root) return true;
		const parent = current.parent.fiber;
		if (parent === current) return false;
		current = parent;
	}
}
/**
* Service names the mounted subtree published into the root realm.
*
* A provider without an `isolate` realm stores its implementation under the
* root's symbol for that name, which is exactly the comparison below; a
* provider inside an `isolate` realm stores under a realm-private symbol and
* is correctly absent here.
* @param ctx - any context of the runtime whose service store is inspected.
* @param mount - the mounted subtree's fiber.
* @returns the leaked service names in lexical order.
*/
function leakedServices(ctx, mount) {
	const store = ctx.reflect.store;
	const rootIsolate = ctx.root[Context.isolate];
	const leaked = [];
	for (const key of Object.getOwnPropertySymbols(store)) {
		const impl = store[key];
		/* v8 ignore next -- cordis deletes a store slot on disposal rather than
		clearing it, so an own symbol always resolves; the guard exists only
		because the store's index signature is optional. */
		if (impl === void 0) continue;
		if (!withinFiber(impl.fiber, mount)) continue;
		if (rootIsolate[impl.name] === key) leaked.push(impl.name);
	}
	return leaked.sort((left, right) => left.localeCompare(right));
}
/**
* The standing composition one agent is joined to.
*
* The agent's own key is parented to its preset's standing key, so the mount
* is found by matching that parent rather than by walking up from the agent —
* the mount is not under the agent's fiber. An agent that joined no preset —
* a deployment composing no roster, or a child agent before its join — has no
* parent link and resolves to undefined.
* @param agentCtx - the agent's scope context.
* @returns the mount the agent joined, or undefined when it joined none.
*/
function standingMountFor(agentCtx) {
	const agentKey = scopeOf(agentCtx);
	if (agentKey === void 0) return void 0;
	const standingKey = scopeParentOf(agentKey);
	if (standingKey === void 0) return void 0;
	return livePresetMounts().find((candidate) => candidate.key === standingKey);
}
/**
* One agent's instance of a service its preset mounted.
*
* A preset publishes a service behind an `isolate` realm so two sessions
* cannot collide, and an entry-local realm is invisible to everything outside
* the group — including the agent's own scope context and the host. That is
* right for the rows inside the group and wrong for one caller: a request that
* is ABOUT a session but arrives from outside it, which is every browser RPC
* the api-proxy serves.
*
* Ownership is the same relation {@link leakedServices} reads, inverted: there
* it names implementations a subtree published into the ROOT realm, here it
* names the one this subtree published anywhere. Fiber membership is object
* identity for the reason stated on {@link withinFiber}.
*
* This is READ addressing for a caller that already holds the agent. It is not
* a general host handle on a session's internals: a host row that `inject`s a
* service cannot use it, because injection resolves before any session exists
* and has no agent to key by — such a service belongs on the host plane.
* @param ctx - any context of the runtime whose service store is inspected.
* @param agent - the agent whose mounted composition to look inside.
* @param name - the service name as the preset's rows resolve it.
* @returns the agent's instance, or undefined when its preset mounts none.
*/
function serviceForAgent(ctx, agent, name) {
	const mount = standingMountFor(agent.ctx);
	if (mount === void 0) return void 0;
	const store = ctx.reflect.store;
	for (const key of Object.getOwnPropertySymbols(store)) {
		const impl = store[key];
		/* v8 ignore next -- cordis deletes a store slot on disposal rather than clearing it */
		if (impl === void 0) continue;
		if (impl.name !== name) continue;
		if (withinFiber(impl.fiber, mount.fiber)) return impl.value;
	}
}
/**
* Rows that did not reach a usable state, each rendered as one diagnostic line.
*
* A row whose module failed to import or whose plugin threw already rejects the
* mount through the loader; what remains observable here is a row still waiting
* for a service the composition never supplies.
* @param tree - the mounted subtree.
* @returns one line per unusable row, empty when every enabled row is usable.
*/
function inactiveRows(tree) {
	const lines = [];
	for (const entry of tree.entries()) {
		if (entry.disabled) continue;
		const fiber = entry.fiber;
		/* v8 ignore next 4 -- the loader rejects an entry whose module or plugin failed,
		so a settled tree never holds an enabled fiber-less entry; the branch exists
		only because `Entry.fiber` is declared optional. */
		if (fiber === void 0) {
			lines.push(`${entry.options.id} (${entry.options.name}): never started`);
			continue;
		}
		const missing = Object.keys(fiber.inject).filter((name) => fiber.ctx.get(name) === void 0);
		if (missing.length > 0) lines.push(`${entry.options.id} (${entry.options.name}): waiting for ${missing.join(", ")}`);
	}
	return lines;
}
/**
* The reportable text of a mount failure.
*
* The loader reports several failed rows as one `AggregateError`, whose own
* message names none of them; without flattening, a composition that fails on
* two rows says only "loader entries failed to apply" and the operator has
* nothing to act on.
* @param error - the value the mount rejected with.
* @returns a single-line-per-cause description.
*/
function mountDetail(error) {
	/* v8 ignore next -- every path into the mount's catch throws an Error: the loader
	wraps a row's thrown value before it propagates, and this module's own
	rejections are Errors. The fallback keeps a hostile value readable. */
	if (!(error instanceof Error)) return String(error);
	if (!(error instanceof AggregateError)) return error.message;
	return [error.message, ...error.errors.map((cause) => `- ${mountDetail(cause)}`)].join("\n");
}
/**
* Mount `preset` under `agentCtx` and return only once every row is usable.
*
* The subtree is owned by `agentCtx`'s fiber, so it unwinds with the agent and
* the caller receives no disposer. A rejection leaves nothing mounted.
* @param agentCtx - the agent's scope context, from the agent factory's `setup`.
* @param preset - the resolved preset to compose the agent from.
* @throws when `agentCtx` carries no scope, a row is unusable, or a row
* published a service into the root realm.
*/
async function mountPreset(agentCtx, preset) {
	if (scopeOf(agentCtx) === void 0) throw new Error(`agent-presets: refusing to mount preset "${preset.id}" into an unscoped context; its registrations would apply to every agent in the process`);
	const config = { path: pathToFileURL(preset.path).href };
	/* v8 ignore next -- the Loader sets `baseUrl` on the root before any scoped context derives from it */
	if (agentCtx.baseUrl !== void 0) harnessBase.set(config, agentCtx.baseUrl);
	pruneDisposedMounts();
	const handle = agentCtx.plugin(PresetTree, config);
	try {
		await handle.await();
		const subtree = mounted.get(config);
		/* v8 ignore next -- the subclass constructor runs before `await()` settles for every mounted tree */
		if (subtree === void 0) throw new Error("mounted subtree did not publish its entry tree");
		const { tree, fiber } = subtree;
		const unusable = inactiveRows(tree);
		if (unusable.length > 0) throw new Error(`${String(unusable.length)} row(s) did not activate:\n${unusable.join("\n")}`);
		const leaked = leakedServices(agentCtx, fiber);
		if (leaked.length > 0) throw new Error(`row(s) published process-global service(s) [${leaked.join(", ")}]; a preset service must sit behind an \`isolate\` realm or move to the host composition`);
		mounts.add({
			presetId: preset.id,
			fiber,
			key: scopeOf(agentCtx)
		});
	} catch (error) {
		try {
			await handle.dispose();
		} catch {}
		throw new PresetMountError(preset.id, `${mountDetail(error)} (${preset.path})`, { cause: error });
	}
}
//#endregion
//#region lib/types/session.js
/**
* The session-log record of which preset a session actually runs.
*
* The creation header names the preset a session STARTED with, and it is
* deep-frozen because that is a creation fact. A session may still change
* preset while it is blank, and the effect of that change outlives the blank
* window: the first turn — and every turn after it — runs under the newly
* mounted composition. Recording the change is what keeps the log honest, and
* it is required outright by the repo's model-visible ⟺ logged rule, since the
* preset decides the tool schemas and prompt sections the model sees.
*
* Reconstruction reads {@link resolveSessionPreset}, never the header alone.
* @module @deepseek-ai/dsh-agent-presets/session
*/
/**
* The preset a session actually runs, newest selection winning.
*
* The header supplies the creation-time value; every later selection is a
* logged event, so the last one is the answer. Reading the header alone
* rebuilds a switched session under the composition it was created with, not
* the one its history was produced under.
* @param session - the session's header and event log.
* @returns the preset id, or `undefined` when the deployment composes none.
*/
function resolveSessionPreset(session) {
	for (let index = session.events.length - 1; index >= 0; index -= 1) {
		const event = session.events[index];
		if (event?.type === "agent-preset/selected") return event.data.agentPreset;
	}
	return session.header.agentPreset;
}
//#endregion
//#region lib/types/index.js
/**
* Agent presets: each session composes its model-facing plugin set from one
* preset `cordis.yml`, mounted ONCE per preset under a standing scope and
* joined by every agent that names it.
*
* The standing mount is what makes a preset one composition rather than one
* per session: its plugin instances, tool registrations, prompt sections, and
* projection units exist exactly once, keyed per session inside the plugins
* themselves (they predate presets and were written for a shared world). An
* agent joins by having its scope key parented to the mount's
* ({@link bindScopeParent}), which makes the mount's registrations visible to
* that agent's views and the mount's listeners receive that agent's events —
* and a host reader with no agent at all (a cold transcript read) resolves
* the same standing registrations by preset id.
*
* This package owns the preset vocabulary, filesystem discovery, and the
* guarded standing mount. It does not decide when an agent is created — the
* agent factory's `setup(agentCtx)` hook is the one supported call site,
* because only there is the join installed while the agent is still
* unpublished, so a rejected composition rolls the whole creation back.
* @module @deepseek-ai/dsh-agent-presets
*/
/** Settings namespace carrying the user's chosen default preset. */
const SETTINGS_NAMESPACE = "agent-presets";
/** Runtime schema for the user-writable slice. */
const AgentPresetSettingsSchema = z.object({ default: z.string() });
/**
* Registry over the deployment's agent presets.
*
* Discovery is unmemoized: `list()` and `resolve()` re-read the roots on every
* call so a preset authored while the process runs is visible immediately,
* and a preset deleted underneath a picker disappears from the next read.
*/
var AgentPresets = class extends Service {
	config;
	static inject = ["loader"];
	/** Runtime schema for the preset roster. */
	static Config = z.object({
		default: z.string().required(),
		roots: z.array(z.object({
			path: z.string().required(),
			trust: z.union(["system", "user"]).default("user")
		})).default([]),
		includeUserRoot: z.boolean().default(true)
	});
	/**
	* The roots discovery and authoring actually scan: every configured root in
	* order, then the harness-home user root unless `includeUserRoot` is false.
	*
	* Derived once, because a root set that changed between `list()` and the
	* `copy()` acting on its answer would author into a directory the caller
	* never saw. Appending rather than prepending keeps an earlier configured
	* root winning a duplicate id, so a shipped preset still shadows a
	* locally authored directory that claimed its name.
	*/
	resolvedRoots;
	/**
	* The user layer over `config.default`, present only while a settings
	* provider is composed. Held rather than snapshotted so a hot-reloaded
	* document takes effect without a restart.
	*/
	settings;
	/**
	* The settings service behind {@link settings}, held for the one write this
	* service makes: clearing a user default it has just deleted.
	*/
	settingsService;
	/**
	* The service's own untraced context. Methods invoked through the traceable
	* proxy see `this.ctx` rebound to the CALLER's context, which carries a
	* shadow; a subtree minted from it resolves every service through that
	* shadow's fiber instead of each entry's own inject store, so preset rows
	* would fail on the very services they declare. Standing mounts must hang
	* off the untraced original (the `jobs-local` selfCtx precedent).
	*/
	selfCtx;
	constructor(ctx, config) {
		super(ctx, "agentPresets");
		this.config = config;
		this.selfCtx = ctx;
		this.resolvedRoots = config.includeUserRoot ? [...config.roots, {
			path: dshHomePath(USER_PRESET_DIR),
			trust: "user"
		}] : [...config.roots];
		ctx.inject(["settings"], (settingsCtx) => {
			this.settings = settingsCtx.settings.register(settingsNamespace(SETTINGS_NAMESPACE), AgentPresetSettingsSchema, { base: { default: config.default } });
			this.settingsService = settingsCtx.settings;
			settingsCtx.effect(() => () => {
				this.settings = void 0;
				this.settingsService = void 0;
			}, "agentPresets.settings()");
		});
		ctx.on("agent/created", ({ agent }) => {
			if (this.resolvedRoots.length === 0) return;
			if (this.composedPreset(agent.ctx) !== void 0) return;
			ctx.logger.warn(`agent "${agent.id}" was published without joining an agent preset; its tools, prompt sections, and skill catalog resolve against the empty global layer (join through AgentPresets.mount() or composeFrom() in the agent factory setup)`);
		});
		ctx.on("session/event", (session, event) => {
			if (event.type !== "agent-preset/selected") return;
			ctx.emit("agent-preset/selected", session.id, event.data.agentPreset);
		});
	}
	/**
	* The preset id mounted when a caller names none.
	*
	* Read per call rather than cached: the settings document is hot-reloaded, so
	* changing the default takes effect on the next session created and leaves
	* every running session on the preset it was composed from.
	*/
	get defaultId() {
		return this.settings?.get().default ?? this.config.default;
	}
	/**
	* Every preset the configured roots currently supply.
	* @returns the presets, first-root-wins per id.
	*/
	async list() {
		return await discoverPresets(this.resolvedRoots);
	}
	/**
	* Resolve one preset by id.
	*
	* A broken preset resolves — deleting one, reading one, and reporting one
	* all need the row — and the mounting paths refuse it AFTER resolution
	* through {@link resolveMountable}.
	* @param id - the preset id, or `undefined` for {@link defaultId}.
	* @returns the resolved preset.
	* @throws when no configured root supplies that id.
	*/
	async resolve(id) {
		const wanted = id ?? this.defaultId;
		const presets = await this.list();
		const found = presets.find((preset) => preset.id === wanted);
		if (found === void 0) throw new UnknownPresetError(wanted, presets.map((preset) => preset.id));
		return found;
	}
	/**
	* Resolve one preset that is about to compose an agent, refusing a broken
	* one with its discovery-reported reason. Failing here rather than inside
	* the loader keeps the answer the same for every unloadable shape — ghost
	* directory, unparsable YAML, rowless list — and spends no mount attempt
	* on a composition discovery already read as unusable.
	* @param id - the preset id, or `undefined` for {@link defaultId}.
	* @returns the resolved, mountable preset.
	* @throws when the preset is unknown or discovery reports it broken.
	*/
	async resolveMountable(id) {
		const preset = await this.resolve(id);
		if (preset.broken !== void 0) throw new PresetMountError(preset.id, preset.broken);
		return preset;
	}
	/**
	* Standing mounts by preset id, single-flight so two agents racing the
	* first use of one preset share one composition. A settled failure is
	* removed so a later session retries a preset whose file has been fixed; a
	* settled success serves until the composition FILE visibly changes — each
	* generation records its file stamp, and a stale stamp starts the next
	* generation for sessions created afterwards. Sessions already joined keep
	* the generation they run on; a superseded one is never disposed while the
	* process lives (reclaimed only by whole-tree teardown), so editing files
	* is bounded by how often compositions change, not by session count.
	*/
	standing = /* @__PURE__ */ new Map();
	/**
	* Parent bindings of the agents this roster composed, keyed by the agent's
	* scope key. The binding is dsh-scope's only re-link capability; holding it
	* here makes this service the sole authority that can move an agent between
	* standing compositions. WeakMap: entries die with their agents.
	*/
	bindings = /* @__PURE__ */ new WeakMap();
	/**
	* Compose one agent from a preset: ensure the preset's standing mount, then
	* parent the agent's scope key to it so the mount's registrations and
	* listeners cover this agent.
	*
	* Call from the agent factory's `setup(agentCtx)`; a rejection there rolls
	* the agent creation back, so a broken preset never yields a half-composed
	* session.
	* @param agentCtx - the agent's scope context.
	* @param id - the preset id, or `undefined` for {@link defaultId}.
	* @returns the preset that was composed, for the caller to record.
	* @throws when the preset is unknown or its composition is unusable.
	*/
	async mount(agentCtx, id) {
		const agentKey = scopeOf(agentCtx);
		if (agentKey === void 0) throw new Error("agent-presets: refusing to compose an unscoped context; the scope key is what joins an agent to its preset");
		const preset = await this.resolveMountable(id);
		const standing = await this.ensureStanding(preset);
		this.bindings.set(agentKey, bindScopeParent(agentKey, standing.key));
		return preset;
	}
	/**
	* Join one agent to the SAME standing composition another already runs on.
	*
	* This is how a child agent inherits its parent's capabilities. It is a bind,
	* not a mount: the parent's generation is already composed, so the child gets
	* that exact instance — the same plugin objects, the same tool registrations,
	* the same prompt sections. Re-resolving the parent's preset by id instead
	* would re-read the roster, and a composition file edited since the parent
	* started would hand the child a DIFFERENT generation than the one its
	* parent's history was produced under (and a preset deleted since would fail
	* the child outright while its parent keeps running).
	*
	* Synchronous, and with no composition failure mode of its own — it reads no
	* roster, mounts nothing, and touches no file — which is what lets a child
	* creation window use it: the two in-process subagent drivers compose their
	* children inside a synchronous `setup`. It still rejects a caller error, as
	* the `@throws` below record.
	*
	* A parent that joined no preset — a rosterless deployment — yields no join
	* and no error: there, the model-facing rows sit in the host composition and
	* the child already sees them through the global layer.
	* @param agentCtx - the joining agent's scope context.
	* @param parentCtx - the scope context of the agent whose composition to join.
	* @returns the preset id joined, or undefined when the parent joined none.
	* @throws when `agentCtx` carries no scope, or has already joined a preset.
	*/
	composeFrom(agentCtx, parentCtx) {
		const agentKey = scopeOf(agentCtx);
		if (agentKey === void 0) throw new Error("agent-presets: refusing to compose an unscoped context; the scope key is what joins an agent to its preset");
		const standing = standingMountFor(parentCtx);
		if (standing === void 0) return void 0;
		this.bindings.set(agentKey, bindScopeParent(agentKey, standing.key));
		return standing.presetId;
	}
	/**
	* The preset one live agent runs on.
	*
	* Read from the live scope chain rather than from the session, so it answers
	* for an agent whose session has not recorded a preset yet — a child agent
	* whose durable header is being built from its parent's composition.
	* @param agentCtx - the agent's scope context.
	* @returns the preset id, or undefined when the agent joined none.
	*/
	composedPreset(agentCtx) {
		return standingMountFor(agentCtx)?.presetId;
	}
	/**
	* The roots this roster scans, which is not `config.roots`: it is every
	* configured root in order, then the harness-home user root unless
	* `includeUserRoot` is false. Read this — not the config field — to answer
	* whether a roster is composed at all, so one derivation decides it.
	*/
	get roots() {
		return this.resolvedRoots;
	}
	/** Whether this deployment has a root locally authored presets go to. */
	get authorable() {
		return this.resolvedRoots.some((root) => root.trust === "user");
	}
	/**
	* Read one preset's composition text.
	* @param id - the preset id.
	* @returns the composition exactly as stored.
	* @throws when no configured root supplies that id.
	*/
	async read(id) {
		return await readComposition(await this.resolve(id));
	}
	/**
	* Create a locally authored preset by copying an existing one whole.
	*
	* Copy is the only authoring write. Composition text never crosses this
	* seam: the source is named by id and its directory is copied as it stands,
	* so the copy is exactly as loadable as its source and authoring grants no
	* capability the roster did not already carry. The copy is NOT mounted to
	* validate — a source that mounts today yields a copy that mounts today.
	* @param from - the preset the copy starts from; shipped presets are the
	* primary source, so any trust is accepted.
	* @param id - the new preset's id, which becomes its directory name.
	* @param name - display name for the copy; absent falls back to the id.
	* @throws when the source is unknown, the id is unusable or already taken,
	* or the deployment configures no writable root.
	*/
	async copy(from, id, name) {
		const source = await this.resolve(from);
		if ((await this.list()).some((preset) => preset.id === id)) throw new PresetExistsError(id);
		await copyComposition(this.resolvedRoots, source, id, name);
		this.standing.delete(id);
	}
	/**
	* Delete a locally authored preset.
	* @param id - the preset id.
	* @throws when the preset is unknown or ships with the deployment.
	*/
	async remove(id) {
		await deleteComposition(this.resolvedRoots, await this.resolve(id));
		this.standing.delete(id);
		if (this.settings?.get().default !== id) return;
		await this.settingsService?.mutate(settingsNamespace(SETTINGS_NAMESPACE), [{
			op: "unset",
			path: ["default"]
		}]);
	}
	/**
	* One agent's instance of a service its preset mounted.
	*
	* A preset publishes services behind `isolate` realms, which are invisible
	* outside the group that declares them — including to the host. This is how a
	* caller holding the agent reads one anyway: a request that is ABOUT a
	* session but arrives from outside it, which is every browser RPC.
	*
	* Read addressing only. A host row that `inject`s a service cannot use this,
	* because injection resolves before any session exists and has no agent to
	* key by; such a service belongs on the host plane instead.
	* @param agent - the agent whose composition to look inside.
	* @param name - the service name as the preset's rows resolve it.
	* @returns the agent's instance, or undefined when its preset mounts none.
	*/
	serviceFor(agent, name) {
		return serviceForAgent(this.ctx, agent, name);
	}
	/**
	* Re-link one agent to a different preset's standing composition.
	*
	* Only valid while the agent has produced nothing: swapping tools mid
	* conversation would leave logged tool calls the new composition cannot
	* make. The CALLER owns that check — this method does not read session
	* history.
	*
	* The swap is a parent re-link, not an unmount: standing mounts are shared
	* and permanent, so the old composition stays for its other agents and the
	* new one is ensured BEFORE the link moves. An unknown or unusable preset
	* therefore throws with the agent exactly as it was — there is no torn-down
	* state to restore. The re-link runs through the binding this roster kept
	* from the agent's mount — dsh-scope's only re-link authority. An agent
	* that never composed one has nothing to re-link: the switch is then the
	* agent's first bind, exactly a mount.
	* @param agentCtx - the agent's scope context.
	* @param id - the preset to compose the agent from instead.
	* @returns the preset now installed.
	* @throws when the preset is unknown or its composition is unusable.
	*/
	async recompose(agentCtx, id) {
		const agentKey = scopeOf(agentCtx);
		if (agentKey === void 0) throw new Error("agent-presets: refusing to recompose an unscoped context");
		const preset = await this.resolveMountable(id);
		const standing = await this.ensureStanding(preset);
		const binding = this.bindings.get(agentKey);
		if (binding === void 0) this.bindings.set(agentKey, bindScopeParent(agentKey, standing.key));
		else binding.rebind(standing.key);
		return preset;
	}
	/**
	* The standing scope key of one preset, for a host reader with no agent.
	*
	* A cold transcript read resolves tool presenters against the composition
	* the session recorded, and the standing mount makes that possible without
	* resuming anything: ensuring the mount composes plugins but starts no
	* agent, no session, and no turn.
	* @param id - the preset id, or `undefined` for {@link defaultId}.
	* @returns the standing scope key readers pass as a registry view scope.
	* @throws when the preset is unknown or its composition is unusable.
	*/
	async standingKeyFor(id) {
		const preset = await this.resolveMountable(id);
		return (await this.ensureStanding(preset)).key;
	}
	/** Resolve (or create, single-flight) the standing mount of one preset. */
	async ensureStanding(preset) {
		const pending = this.standing.get(preset.id);
		if (pending !== void 0) {
			const mounted = await pending;
			const current = await compositionStamp(preset.path);
			if (current === void 0 || sameStamp(mounted.stamp, current)) return mounted;
			if (this.standing.get(preset.id) === pending) this.standing.delete(preset.id);
			return this.ensureStanding(preset);
		}
		const created = (async () => {
			const key = { agentPreset: preset.id };
			const scope = createScope(this.selfCtx, key);
			try {
				const stamp = await compositionStamp(preset.path);
				if (stamp === void 0) throw new PresetMountError(preset.id, `composition file is unreadable: ${preset.path}`);
				await mountPreset(scope.ctx, preset);
				return {
					key,
					scope,
					stamp
				};
			} catch (error) {
				this.standing.delete(preset.id);
				await scope.dispose();
				throw error;
			}
		})();
		this.standing.set(preset.id, created);
		return created;
	}
};
/** Read one composition file's stamp, or undefined when it cannot be statted. */
async function compositionStamp(path) {
	try {
		const { mtimeMs, size } = await stat(path);
		return {
			mtimeMs,
			size
		};
	} catch {
		return;
	}
}
/** Whether two stamps name the same file state. */
function sameStamp(a, b) {
	return a.mtimeMs === b.mtimeMs && a.size === b.size;
}
//#endregion
export { AgentPresetSettingsSchema, AgentPresets, AgentPresets as default, COMPOSITION_FILE, InvalidPresetIdError, METADATA_FILE, PresetExistsError, PresetMountError, PresetNotWritableError, SETTINGS_NAMESPACE, UnknownPresetError, copyComposition, deleteComposition, discoverPresets, inactiveRows, leakedServices, livePresetMounts, mountPreset, readComposition, readPresetMetadata, renderPresetMetadata, resolveSessionPreset, scanRoot, serviceForAgent, standingMountFor, writableRoot };
