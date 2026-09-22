//#region lib/types/invariant.js
/** Package-owned invariant companion. @module @deepseek-ai/dsh-message-feedback/invariant */
const PACKAGE_NAME = "@deepseek-ai/dsh-message-feedback";
/** Cordis companion plugin name. */
const name = "message-feedback-invariant";
/** Services required before the companion can reserve and check package ownership. */
const inject = ["invariants"];
/**
* No runtime invariant: the private typed writer owns current row mutations,
* the domain schema validates rows on reopen, and no second authority exists.
*/
const install = Object.assign(() => {}, { inject: ["messageFeedback"] });
/**
* Register this package's invariant companion.
* @param ctx - Cordis context carrying the invariant service.
* @returns the installed registration's disposer after setup succeeds.
*/
const apply = (ctx) => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install));
//#endregion
export { apply, inject, name };
