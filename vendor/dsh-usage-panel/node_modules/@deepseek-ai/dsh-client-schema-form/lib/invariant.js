//#region lib/types/invariant.js
/**
* Package-owned invariant companion for `@deepseek-ai/dsh-client-schema-form`.
* @module @deepseek-ai/dsh-client-schema-form/invariant
*/
const PACKAGE_NAME = "@deepseek-ai/dsh-client-schema-form";
/** Cordis companion plugin name. */
const name = "client-schema-form-invariant";
/** Service required before the companion can reserve package ownership. */
const inject = ["invariants"];
/**
* No runtime invariant: a pure schema/draft helper library — it emits no
* cordis events and owns no cross-plugin mutable relation; draft
* immutability, schema rehydration, and path-edit round trips are asserted
* directly by this package's model specs.
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
