import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applySlashCommand,
  filterSlashCommands,
  listAgentCommands,
  slashQuery,
} from './commands.js';

test('slashQuery only matches a lone leading slash token', () => {
  assert.equal(slashQuery('/'), '');
  assert.equal(slashQuery('/co'), 'co');
  assert.equal(slashQuery('/commit'), 'commit');
  assert.equal(slashQuery('/commit now'), null);
  assert.equal(slashQuery('hello /commit'), null);
  assert.equal(slashQuery('//'), null);
  assert.equal(slashQuery(''), null);
  assert.equal(slashQuery(undefined), null);
});

test('filterSlashCommands ranks prefix matches before substring matches', () => {
  const commands = [
    { name: 'review', description: '审查代码' },
    { name: 'commit', description: '提交更改' },
    { name: 'pr', description: 'commit and open PR' },
  ];
  assert.deepEqual(
    filterSlashCommands(commands, 'co').map((command) => command.name),
    ['commit', 'pr'],
  );
  assert.equal(filterSlashCommands(commands, '').length, 3);
  assert.deepEqual(filterSlashCommands(commands, 'zzz'), []);
});

test('applySlashCommand inserts the command ready for arguments', () => {
  assert.equal(applySlashCommand('commit'), '/commit ');
});

test('listAgentCommands normalizes daemon rows and surfaces errors', async () => {
  const calls = [];
  const client = {
    async listCommands(agentId) {
      calls.push(agentId);
      return {
        commands: [
          { name: 'commit', description: '提交', argumentHint: '<message>' },
          { name: 'bare' },
          { description: '没有名字' },
        ],
      };
    },
  };
  const rows = await listAgentCommands(client, 'a1');
  assert.deepEqual(calls, ['a1']);
  assert.deepEqual(rows, [
    { name: 'commit', description: '提交', argumentHint: '<message>' },
    { name: 'bare', description: '', argumentHint: '' },
  ]);

  await assert.rejects(() => listAgentCommands(client, ''), /缺少会话 ID/);
  await assert.rejects(
    () => listAgentCommands({ async listCommands() { return { error: 'provider offline' }; } }, 'a1'),
    /provider offline/,
  );
});
