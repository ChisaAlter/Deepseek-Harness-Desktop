/** Package-owned invariant companion. @module @deepseek-ai/dsh-host-plugin-inventory/invariant */
const PACKAGE_NAME = '@deepseek-ai/dsh-host-plugin-inventory';
/** Cordis companion plugin name. */
export const name = 'host-plugin-inventory-invariant';
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants'];
/** No runtime invariant: every snapshot is projected directly from Loader-owned state. */
const install = () => { };
/** Register this package's invariant companion. */
export const apply = (ctx) => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install));
/* jscpd:ignore-end */
//# sourceMappingURL=invariant.js.map