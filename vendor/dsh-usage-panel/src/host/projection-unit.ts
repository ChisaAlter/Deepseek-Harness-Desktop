// dsh-usage-panel · projection unit registered against ctx.sessionProjections.
// The unit is pure: init/apply/wire.view with plain-JSON state and a stateVersion
// that invalidates persisted checkpoint rows when fold semantics change.
// Desktop harness reads stateSchema + wire (client-visible). npm rc.6 d.ts still
// describes schema + top-level view; do not satisfy that stale face.
import { USAGE_PANEL_KEY, applyEvent, initState, usagePanelSchema, type UsagePanelState } from './projection.ts'

export const PROJECTION_STATE_VERSION = 2

export const usagePanelProjectionDefinition = {
  key: USAGE_PANEL_KEY,
  stateVersion: PROJECTION_STATE_VERSION,
  stateSchema: usagePanelSchema,
  init: initState,
  apply: applyEvent,
  wire: {
    viewSchema: usagePanelSchema,
    view: (state: UsagePanelState) => state,
  },
}
