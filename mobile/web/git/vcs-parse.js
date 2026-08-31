// 镜像 mobile/android :protocol git/VcsParse.kt（VcsStatus / 分支列表 JSON 解析）。

function parseVcsStatus(obj) {
  const source = obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : null;
  const prObj = source?.pr && typeof source.pr === 'object' && !Array.isArray(source.pr) ? source.pr : null;
  return {
    isRepo: source ? source.isRepo !== false : false,
    refName: typeof source?.refName === 'string' ? source.refName : null,
    hasWorkingTreeChanges: source?.hasWorkingTreeChanges === true,
    hasUpstream: source?.hasUpstream === true,
    aheadCount: Number.isInteger(source?.aheadCount) ? source.aheadCount : 0,
    behindCount: Number.isInteger(source?.behindCount) ? source.behindCount : 0,
    isDefaultRef: source?.isDefaultRef === true,
    hasPrimaryRemote: source?.hasPrimaryRemote === true,
    pr: prObj
      ? {
        state: typeof prObj.state === 'string' ? prObj.state : null,
        number: Number.isInteger(prObj.number) ? prObj.number : null,
        url: typeof prObj.url === 'string' ? prObj.url : null,
      }
      : null,
  };
}

function parseBranchList(obj) {
  const items = Array.isArray(obj?.branches) ? obj.branches : [];
  const rows = [];
  for (const item of items) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    if (typeof item.name !== 'string' || !item.name) continue;
    rows.push({
      name: item.name,
      isRemote: item.isRemote === true,
      isCurrent: item.isCurrent === true,
      switchable: item.switchable !== false,
      hint: typeof item.hint === 'string' ? item.hint : '',
    });
  }
  return rows;
}

export { parseVcsStatus, parseBranchList };
