/**
 * Full daemon permission handling: view models that preserve the daemon's
 * action list (label / behavior / variant / selectedActionId) instead of
 * flattening every request into generic allow/deny, plus queue helpers for
 * multi-pending and cross-client resolution.
 */

const ACTION_VARIANTS = new Set(['primary', 'secondary', 'danger']);

function actionViewModel(action) {
  if (!action || typeof action.id !== 'string' || !action.id) return null;
  if (action.behavior !== 'allow' && action.behavior !== 'deny') return null;
  return {
    id: action.id,
    label: typeof action.label === 'string' && action.label ? action.label : action.id,
    behavior: action.behavior,
    variant: ACTION_VARIANTS.has(action.variant) ? action.variant : 'secondary',
  };
}

/**
 * Map a daemon AgentPermissionRequest into the phone approval view model.
 * `actions` stays exactly what the daemon offered; an empty list means the
 * UI must fall back to generic allow/deny.
 * @param {object} request AgentPermissionRequest payload
 */
function approvalFromRequest(request) {
  if (!request || typeof request.id !== 'string' || !request.id) return null;
  const actions = Array.isArray(request.actions)
    ? request.actions.map(actionViewModel).filter(Boolean)
    : [];
  return {
    requestId: request.id,
    title: request.title || request.name || '需要审批',
    command: request.description || '',
    actions,
  };
}

/** All pending approvals from an agent snapshot, in daemon order. */
function approvalsFromAgent(agent) {
  const pending = Array.isArray(agent?.pendingPermissions) ? agent.pendingPermissions : [];
  return pending.map(approvalFromRequest).filter(Boolean);
}

/** Remove one resolved request from the pending queue (cross-client too). */
function removeApproval(list, requestId) {
  return (list || []).filter((approval) => approval.requestId !== requestId);
}

/** Wire response for a daemon-provided action button. */
function responseForAction(action) {
  return { behavior: action.behavior, selectedActionId: action.id };
}

/** Wire response for the generic fallback buttons (no daemon actions). */
function genericResponse(behavior) {
  if (behavior !== 'allow' && behavior !== 'deny') {
    throw new Error(`未知审批行为：${behavior}`);
  }
  return { behavior };
}

export {
  approvalFromRequest,
  approvalsFromAgent,
  genericResponse,
  removeApproval,
  responseForAction,
};
