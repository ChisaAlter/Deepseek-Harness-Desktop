/**
 * ChisaCode Diff work-loop adapters: read-only checkout diff over
 * `getCheckoutDiff` (one-shot; live subscription is a later phase). Supports
 * the `uncommitted` and `base` compare scopes and classifies the daemon
 * payload into explicit view states: non-git, error, empty, files.
 * Read-only by contract — there is no stage / unstage / discard RPC and no
 * such control may be rendered from this data.
 */

const DIFF_SCOPES = [
  { id: 'uncommitted', label: '未提交' },
  { id: 'base', label: '对比主干' },
];

function diffScopeLabel(scope) {
  return DIFF_SCOPES.find((entry) => entry.id === scope)?.label || String(scope || '');
}

function hunkHeader(hunk) {
  const oldStart = Number.isFinite(hunk?.oldStart) ? hunk.oldStart : 0;
  const oldCount = Number.isFinite(hunk?.oldCount) ? hunk.oldCount : 0;
  const newStart = Number.isFinite(hunk?.newStart) ? hunk.newStart : 0;
  const newCount = Number.isFinite(hunk?.newCount) ? hunk.newCount : 0;
  return `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`;
}

/**
 * Normalize one ParsedDiffFile for rendering. Highlight tokens are dropped on
 * purpose: their style names target the desktop highlighter stylesheet and
 * faking syntax colors on the phone would be a lie — line-level add/remove
 * coloring only.
 */
function diffFileView(file) {
  const hunks = Array.isArray(file?.hunks) ? file.hunks : [];
  return {
    path: typeof file?.path === 'string' ? file.path : '',
    isNew: file?.isNew === true,
    isDeleted: file?.isDeleted === true,
    additions: Number.isFinite(file?.additions) ? file.additions : 0,
    deletions: Number.isFinite(file?.deletions) ? file.deletions : 0,
    status: file?.status === 'too_large' || file?.status === 'binary' ? file.status : 'ok',
    hunks: hunks.map((hunk) => ({
      header: hunkHeader(hunk),
      lines: (Array.isArray(hunk?.lines) ? hunk.lines : []).map((line) => ({
        type: ['add', 'remove', 'context', 'header'].includes(line?.type) ? line.type : 'context',
        content: typeof line?.content === 'string' ? line.content : '',
      })),
    })),
  };
}

/** Badge text for a diff file row; empty string when nothing special. */
function diffFileBadge(file) {
  if (file?.status === 'binary') return '二进制';
  if (file?.status === 'too_large') return '文件过大';
  if (file?.isNew) return '新增';
  if (file?.isDeleted) return '已删除';
  return '';
}

/**
 * Classify a checkout-diff payload into the view state. NOT_GIT_REPO is a
 * distinct honest state (by error code, not message matching); other daemon
 * errors keep their original message.
 * @returns {{ kind: 'non-git' }
 *   | { kind: 'error', message: string }
 *   | { kind: 'empty' }
 *   | { kind: 'files', files: Array<object> }}
 */
function diffViewState(payload) {
  const error = payload?.error;
  if (error) {
    if (error.code === 'NOT_GIT_REPO') {
      return { kind: 'non-git' };
    }
    const message = typeof error.message === 'string' && error.message
      ? error.message
      : '读取改动失败';
    return { kind: 'error', message };
  }
  const files = (Array.isArray(payload?.files) ? payload.files : [])
    .map(diffFileView)
    .filter((file) => file.path);
  if (!files.length) {
    return { kind: 'empty' };
  }
  return { kind: 'files', files };
}

/**
 * Fetch the read-only diff for one scope. Transport failures reject; daemon
 * payload errors become structured view states via diffViewState.
 * @param {object} client DaemonClient
 * @param {string} cwd workspace root
 * @param {'uncommitted' | 'base'} scope
 */
async function fetchMobileDiff(client, cwd, scope) {
  if (scope !== 'uncommitted' && scope !== 'base') {
    throw new Error(`未知的改动范围：${scope}`);
  }
  const payload = await client.getCheckoutDiff(cwd, { mode: scope });
  return diffViewState(payload);
}

export {
  DIFF_SCOPES,
  diffFileBadge,
  diffFileView,
  diffScopeLabel,
  diffViewState,
  fetchMobileDiff,
};
