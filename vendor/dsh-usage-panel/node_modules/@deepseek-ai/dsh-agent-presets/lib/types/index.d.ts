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
import { Context, Service } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import { type ScopeKey } from '@deepseek-ai/dsh-scope';
import { type AgentPreset, type Config, type PresetRoot } from './preset.ts';
/** Settings namespace carrying the user's chosen default preset. */
export declare const SETTINGS_NAMESPACE = "agent-presets";
/** The user-writable slice of this plugin's config. */
export interface AgentPresetSettings {
    /** Preset mounted when a session names none. */
    default?: string;
}
/** Runtime schema for the user-writable slice. */
export declare const AgentPresetSettingsSchema: z<AgentPresetSettings>;
export { COMPOSITION_FILE, discoverPresets, scanRoot } from './discovery.ts';
export { METADATA_FILE, readPresetMetadata, renderPresetMetadata, type PresetMetadata, } from './metadata.ts';
export { inactiveRows, leakedServices, livePresetMounts, mountPreset, serviceForAgent, standingMountFor, type JoinedPresetMount, type PresetMount, } from './mount.ts';
export { copyComposition, deleteComposition, InvalidPresetIdError, PresetExistsError, PresetNotWritableError, readComposition, writableRoot, } from './authoring.ts';
export { resolveSessionPreset, type PresetBearingSession } from './session.ts';
export { PresetMountError, UnknownPresetError } from './preset.ts';
export type { AgentPreset, Config, PresetRoot, PresetTrust } from './preset.ts';
declare module '@deepseek-ai/cordis' {
    interface Context {
        agentPresets: AgentPresets;
    }
}
/**
 * Registry over the deployment's agent presets.
 *
 * Discovery is unmemoized: `list()` and `resolve()` re-read the roots on every
 * call so a preset authored while the process runs is visible immediately,
 * and a preset deleted underneath a picker disappears from the next read.
 */
export declare class AgentPresets extends Service {
    config: Config;
    static inject: string[];
    /** Runtime schema for the preset roster. */
    static Config: z<Config>;
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
    private readonly resolvedRoots;
    /**
     * The user layer over `config.default`, present only while a settings
     * provider is composed. Held rather than snapshotted so a hot-reloaded
     * document takes effect without a restart.
     */
    private settings;
    /**
     * The settings service behind {@link settings}, held for the one write this
     * service makes: clearing a user default it has just deleted.
     */
    private settingsService;
    /**
     * The service's own untraced context. Methods invoked through the traceable
     * proxy see `this.ctx` rebound to the CALLER's context, which carries a
     * shadow; a subtree minted from it resolves every service through that
     * shadow's fiber instead of each entry's own inject store, so preset rows
     * would fail on the very services they declare. Standing mounts must hang
     * off the untraced original (the `jobs-local` selfCtx precedent).
     */
    private readonly selfCtx;
    constructor(ctx: Context, config: Config);
    /**
     * The preset id mounted when a caller names none.
     *
     * Read per call rather than cached: the settings document is hot-reloaded, so
     * changing the default takes effect on the next session created and leaves
     * every running session on the preset it was composed from.
     */
    get defaultId(): string;
    /**
     * Every preset the configured roots currently supply.
     * @returns the presets, first-root-wins per id.
     */
    list(): Promise<AgentPreset[]>;
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
    resolve(id?: string): Promise<AgentPreset>;
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
    private resolveMountable;
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
    private readonly standing;
    /**
     * Parent bindings of the agents this roster composed, keyed by the agent's
     * scope key. The binding is dsh-scope's only re-link capability; holding it
     * here makes this service the sole authority that can move an agent between
     * standing compositions. WeakMap: entries die with their agents.
     */
    private readonly bindings;
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
    mount(agentCtx: Context, id?: string): Promise<AgentPreset>;
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
    composeFrom(agentCtx: Context, parentCtx: Context): string | undefined;
    /**
     * The preset one live agent runs on.
     *
     * Read from the live scope chain rather than from the session, so it answers
     * for an agent whose session has not recorded a preset yet — a child agent
     * whose durable header is being built from its parent's composition.
     * @param agentCtx - the agent's scope context.
     * @returns the preset id, or undefined when the agent joined none.
     */
    composedPreset(agentCtx: Context): string | undefined;
    /**
     * The roots this roster scans, which is not `config.roots`: it is every
     * configured root in order, then the harness-home user root unless
     * `includeUserRoot` is false. Read this — not the config field — to answer
     * whether a roster is composed at all, so one derivation decides it.
     */
    get roots(): readonly PresetRoot[];
    /** Whether this deployment has a root locally authored presets go to. */
    get authorable(): boolean;
    /**
     * Read one preset's composition text.
     * @param id - the preset id.
     * @returns the composition exactly as stored.
     * @throws when no configured root supplies that id.
     */
    read(id: string): Promise<string>;
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
    copy(from: string, id: string, name?: string): Promise<void>;
    /**
     * Delete a locally authored preset.
     * @param id - the preset id.
     * @throws when the preset is unknown or ships with the deployment.
     */
    remove(id: string): Promise<void>;
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
    serviceFor<K extends string & keyof Context>(agent: {
        ctx: Context;
    }, name: K): Context[K] | undefined;
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
    recompose(agentCtx: Context, id: string): Promise<AgentPreset>;
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
    standingKeyFor(id?: string): Promise<ScopeKey>;
    /** Resolve (or create, single-flight) the standing mount of one preset. */
    private ensureStanding;
}
export default AgentPresets;
//# sourceMappingURL=index.d.ts.map