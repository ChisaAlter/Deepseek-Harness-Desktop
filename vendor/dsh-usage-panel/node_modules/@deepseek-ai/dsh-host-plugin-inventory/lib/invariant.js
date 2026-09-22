//#region lib/types/invariant.js
/** Package-owned invariant companion. @module @deepseek-ai/dsh-host-plugin-inventory/invariant */
const PACKAGE_NAME = "@deepseek-ai/dsh-host-plugin-inventory";
/** Cordis companion plugin name. */
const name = "host-plugin-inventory-invariant";
/** Service required before the companion can reserve package ownership. */
const inject = ["invariants"];
/** No runtime invariant: every snapshot is projected directly from Loader-owned state. */
const install = () => {};
/** Register this package's invariant companion. */
const apply = (ctx) => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install));
//#endregion
export { apply, inject, name };
