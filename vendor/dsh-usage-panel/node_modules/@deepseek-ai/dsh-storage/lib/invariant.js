//#region lib/types/invariant.js
/**
* Package-owned invariant companion for `@deepseek-ai/dsh-storage`.
* @module @deepseek-ai/dsh-storage/invariant
*/
const PACKAGE_NAME = "@deepseek-ai/dsh-storage";
/** Cordis companion plugin name. */
const name = "storage-invariant";
/** Service required before the companion can reserve package ownership. */
const inject = ["invariants"];
/**
* No runtime invariant: the hub is a pure registration table (names →
* backends, forms → facilities) whose consistency is fully enforced at the
* call sites (duplicate/missing entries fail loud synchronously); it owns no
* event stream or mutable medium to cross-check.
*/
const install = () => {};
/**
* Register this package's invariant companion.
* @param ctx - Cordis context carrying the invariant service.
* @returns the installed registration's disposer after setup succeeds.
*/
const apply = (ctx) => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install));
//#endregion
export { apply, inject, name };
