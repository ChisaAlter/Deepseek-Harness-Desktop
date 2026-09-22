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
import { type AgentPreset, type PresetRoot } from './preset.ts';
/** A preset id that cannot be used as a directory name under a root. */
export declare class InvalidPresetIdError extends Error {
    /** The rejected id. */
    readonly presetId: string;
    constructor(
    /** The rejected id. */
    presetId: string);
}
/** A copy target that is already occupied — a copy never overwrites. */
export declare class PresetExistsError extends Error {
    /** The id that is already taken. */
    readonly presetId: string;
    constructor(
    /** The id that is already taken. */
    presetId: string);
}
/** Authoring was attempted where the deployment allows none. */
export declare class PresetNotWritableError extends Error {
    /** What the caller tried to change, for the diagnostic. */
    readonly presetId: string;
    constructor(
    /** What the caller tried to change, for the diagnostic. */
    presetId: string, reason: string);
}
/**
 * The root locally authored presets are written to.
 * @param roots - the configured roots in precedence order.
 * @returns the absolute path of the first `user` root.
 * @throws when the deployment configured no writable root.
 */
export declare function writableRoot(roots: readonly PresetRoot[]): string;
/**
 * Read one preset's composition text.
 * @param preset - the resolved preset.
 * @returns the file's contents.
 */
export declare function readComposition(preset: AgentPreset): Promise<string>;
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
export declare function copyComposition(roots: readonly PresetRoot[], source: AgentPreset, id: string, name?: string): Promise<string>;
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
export declare function deleteComposition(roots: readonly PresetRoot[], preset: AgentPreset): Promise<void>;
//# sourceMappingURL=authoring.d.ts.map