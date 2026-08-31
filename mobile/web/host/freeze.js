const FILES_DIFF_FREEZE = '下一轮接 host/gitDiff；请暂时用电脑端。';
const MCP_SKILLS_FREEZE = '下一轮只读清单；启用、停用、安装请在电脑端操作。';

function freezePane(kind) {
  if (kind === 'mcp' || kind === 'skills') {
    return { frozen: true, title: kind === 'mcp' ? 'MCP' : '技能', body: MCP_SKILLS_FREEZE };
  }
  return {
    frozen: true,
    title: kind === 'diff' ? '更改' : '文件',
    body: FILES_DIFF_FREEZE,
  };
}

export { FILES_DIFF_FREEZE, MCP_SKILLS_FREEZE, freezePane };
