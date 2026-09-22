const HOST_SLASH_COMMANDS = [
  { name: 'permission', argumentHint: '<id>', description: '切换权限预设' },
  { name: 'plan', argumentHint: 'off', description: '关闭计划模式' },
];

function hostSlashCommands() {
  return HOST_SLASH_COMMANDS.slice();
}

export { HOST_SLASH_COMMANDS, hostSlashCommands };
