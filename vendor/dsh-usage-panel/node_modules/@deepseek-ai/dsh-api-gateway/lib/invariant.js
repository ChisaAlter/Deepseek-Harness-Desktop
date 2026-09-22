//#region lib/types/invariant.js
/**
* Package-owned invariant companion for `@deepseek-ai/dsh-api-gateway`.
* @module @deepseek-ai/dsh-api-gateway/invariant
*/
const PACKAGE_NAME = "@deepseek-ai/dsh-api-gateway";
/** Cordis companion plugin name. */
const name = "api-gateway-invariant";
/** Service required before the companion can reserve package ownership. */
const inject = ["invariants"];
/**
* No runtime invariant: Host calls re-read authoritative Cordis and Typert
* state, while Client methods, descriptors, and `$on` subscriptions mutate in
* one owned effect.
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
