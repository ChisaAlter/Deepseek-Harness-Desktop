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
import { type AgentPreset, type PresetRoot } from './preset.ts';
/** The composition file that makes a directory a preset. */
export declare const COMPOSITION_FILE = "agent.cordis.yml";
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
export declare const USER_PRESET_DIR = ".agent-presets";
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
export declare function scanRoot(root: PresetRoot): Promise<AgentPreset[]>;
/**
 * Scan every root in precedence order.
 * @param roots - roots in precedence order; an earlier root wins a duplicate id.
 * @returns every discovered preset, first-root-wins per id.
 */
export declare function discoverPresets(roots: readonly PresetRoot[]): Promise<AgentPreset[]>;
//# sourceMappingURL=discovery.d.ts.map