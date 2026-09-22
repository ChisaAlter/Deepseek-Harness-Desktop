/** Read-only projection of the current Cordis Loader plugin entries. */
import type { Context } from '@deepseek-ai/cordis';
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import type { PluginInventorySnapshot } from './types.ts';
export type * from './types.ts';
/** Remote-only service exposing the Loader's current non-group entry state. */
export declare class PluginInventoryGateway extends TypertRemoteService {
    static inject: string[];
    constructor(ctx: Context);
    /**
     * Read the Loader directly on every call. Cordis's internal plugin/status
     * events already maintain Entry.fiber and Fiber.state, so a second cache
     * would only add another lifecycle truth to keep synchronized.
     * @returns Current non-group Loader entries in Loader order.
     */
    list(): PluginInventorySnapshot;
}
export default PluginInventoryGateway;
//# sourceMappingURL=index.d.ts.map