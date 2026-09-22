import { access, readFile, readdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '..');

async function readSourceTree(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const chunks = [];
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      chunks.push(await readSourceTree(path));
    } else if (entry.isFile() && /\.m?js$/u.test(entry.name)) {
      chunks.push(await readFile(path, 'utf8'));
    }
  }
  return chunks.join('\n');
}

const required = [
  'lib/index.js',
  'lib/client.js',
  'bin/dsh-im.mjs',
  'cordis.patch.yml',
  'README.md',
  'THIRD_PARTY_NOTICES.md',
  'plugin-src/client/channels/dingtalk/index.js',
  'plugin-src/client/channels/slack/index.js',
  'plugin-src/client/i18n.js',
  'plugin-src/host/channels/feishu/index.mjs',
  'plugin-src/host/channels/weixin/index.mjs',
  'plugin-src/host/channels/dingtalk/index.mjs',
  'plugin-src/host/channels/qq/index.mjs',
  'plugin-src/host/channels/slack/index.mjs',
  'plugin-src/host/channels/wecom/index.mjs',
  'plugin-src/host/channels/telegram/index.mjs',
  'plugin-src/host/channels/discord/index.mjs',
  'plugin-src/host/channels/whatsapp/index.mjs',
  'src/channels/feishu/feishu-runtime.mjs',
  'src/channels/weixin/weixin-runtime.mjs',
  'src/channels/dingtalk/dingtalk-runtime.mjs',
  'src/channels/qq/qq-runtime.mjs',
  'src/channels/slack/slack-runtime.mjs',
  'src/channels/wecom/wecom-runtime.mjs',
  'src/channels/telegram/telegram-runtime.mjs',
  'src/channels/discord/discord-runtime.mjs',
  'src/channels/whatsapp/whatsapp-runtime.mjs',
  'src/channels/whatsapp/whatsapp-web-session.mjs',
];
await Promise.all(required.map((path) => access(resolve(root, path))));

const [
  client,
  host,
  patch,
  manifestText,
  lockText,
  hostSource,
  clientEntrySource,
  clientSources,
  executable,
  executableSource,
] = await Promise.all([
  readFile(resolve(root, 'lib/client.js'), 'utf8'),
  readFile(resolve(root, 'lib/index.js'), 'utf8'),
  readFile(resolve(root, 'cordis.patch.yml'), 'utf8'),
  readFile(resolve(root, 'package.json'), 'utf8'),
  readFile(resolve(root, 'package-lock.json'), 'utf8'),
  readFile(resolve(root, 'plugin-src/host/index.mjs'), 'utf8'),
  readFile(resolve(root, 'plugin-src/client/index.js'), 'utf8'),
  readSourceTree(resolve(root, 'plugin-src/client')),
  stat(resolve(root, 'bin/dsh-im.mjs')),
  readFile(resolve(root, 'bin/dsh-im.mjs'), 'utf8'),
]);
const manifest = JSON.parse(manifestText);
const lock = JSON.parse(lockText);

// DSH runtime packages use module-local Symbol keys, so a second physical copy breaks Host lookup.
const forbiddenDshDependency = /^@deepseek-ai\/dsh-/;
const dependencySections = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
];
for (const section of dependencySections) {
  for (const name of Object.keys(manifest[section] ?? {})) {
    if (forbiddenDshDependency.test(name)) {
      throw new Error(
        `${name} must not be declared in ${section}; DSH runtime packages must come from the host`,
      );
    }
  }
}
const bundledDependencies = manifest.bundleDependencies ?? manifest.bundledDependencies ?? [];
if (Array.isArray(bundledDependencies)) {
  for (const name of bundledDependencies) {
    if (forbiddenDshDependency.test(name)) {
      throw new Error(`${name} must not be bundled; DSH runtime packages must come from the host`);
    }
  }
}
const forbiddenDshLockPaths = Object.keys(lock.packages ?? {}).filter((path) => (
  /(?:^|\/)node_modules\/@deepseek-ai\/dsh-[^/]+(?:\/|$)/.test(path)
));
if (forbiddenDshLockPaths.length > 0) {
  throw new Error(
    `package lock must not install DSH runtime packages: ${forbiddenDshLockPaths.join(', ')}`,
  );
}

if (!/\bid\s*:\s*["']@xmanrui\/dsh-im["']/u.test(client)) {
  throw new Error('client bundle does not register the dsh-im loader id');
}
const remoteTabInjectionPattern = /ctx\.slots\.inject\(\s*["']settings\.remote\.tab["']/gu;
const remoteTabRegistrationPattern = /ctx\.slots\.inject\(\s*["']settings\.remote\.tab["']\s*,\s*\(\)\s*=>\s*ctx\.slots\.register\(\s*\{([\s\S]*?)\}\s*,/u;
const remoteTabMarkers = [
  /name\s*:\s*["']settings\.remote\.tab["']/u,
  /id\s*:\s*["']channels["']/u,
  /order\s*:\s*10\b/u,
  /locale\s*:\s*IM_LOCALE_NAMESPACE\b/u,
];
const sourceRemoteTabOptions = clientEntrySource.match(remoteTabRegistrationPattern)?.[1];
const bundleRemoteTabOptions = client.match(remoteTabRegistrationPattern)?.[1];
const hasRemoteTabShape = (options) => options !== undefined
  && remoteTabMarkers.every((pattern) => pattern.test(options));
if ((clientEntrySource.match(remoteTabInjectionPattern) ?? []).length !== 1
  || (client.match(remoteTabInjectionPattern) ?? []).length !== 1
  || !hasRemoteTabShape(sourceRemoteTabOptions)
  || !hasRemoteTabShape(bundleRemoteTabOptions)
  || !/IM_LOCALE_NAMESPACE\s*=\s*["']dsh-im["']/u.test(clientSources)
  || !/IM_LOCALE_NAMESPACE\s*=\s*["']dsh-im["']/u.test(client)) {
  throw new Error('client source and bundle must register exactly one settings.remote.tab child slot with the channels shape');
}
if (clientEntrySource.includes('settings.section')
  || clientSources.includes('settings.section')
  || client.includes('settings.section')) {
  throw new Error('client source or bundle still registers the legacy top-level settings.section slot');
}
if (client.includes('settings.plugins.tab') || clientSources.includes('settings.plugins.tab')) {
  throw new Error('client source or bundle still contains the legacy Plugins-tab settings entry');
}
if (/role:\s*["']switch|type:\s*["']checkbox/.test(client)) {
  throw new Error('client bundle contains a channel enable switch');
}
if (!client.includes('container-type: inline-size')
  || !client.includes('@container (max-width: 680px)')) {
  throw new Error('client bundle does not contain the narrow-panel DingTalk QR layout');
}
for (const marker of ['/feishu', '/weixin', '/dingtalk', '/wecom', '/qq', '/slack', '/telegram', '/discord', '/whatsapp']) {
  if (!host.includes(marker)) {
    throw new Error(`host bundle does not contain the internal ${marker} RPC provider`);
  }
}
for (const marker of ['/session Session ID', 'bindWorkspaceSession', 'session-subagent-unsupported']) {
  if (!host.includes(marker)) {
    throw new Error(`host bundle does not contain the Session binding marker: ${marker}`);
  }
}
if (/@xmanrui\/dsh-(?:feishu|weixin|dingtalk)/.test(host)) {
  throw new Error('host bundle still imports an external channel plugin');
}
if (/@xmanrui\/dsh-(?:feishu|weixin|dingtalk)/.test(
  manifestText + lockText + hostSource + clientSources,
)) {
  throw new Error('source or package metadata still depends on an external channel plugin');
}
if (!patch.includes("name: '@xmanrui/dsh-im'") || /dsh-(?:feishu|weixin|dingtalk)/.test(patch)) {
  throw new Error('bundle patch must activate only dsh-im');
}
for (const name of ['@xmanrui/dsh-feishu', '@xmanrui/dsh-weixin', '@xmanrui/dsh-dingtalk']) {
  if (manifest.dependencies?.[name]) {
    throw new Error(`${name} must not remain an external dependency`);
  }
}
const directDependencies = {
  'dingtalk-stream': '2.1.4',
  '@tencent-connect/qqbot-connector': '1.2.0',
  '@tencent-connect/qqbot-nodejs': '1.0.4',
  '@wecom/aibot-node-sdk': '1.0.7',
  qrcode: '1.5.4',
};
for (const [name, version] of Object.entries(directDependencies)) {
  if (manifest.dependencies?.[name] !== version) {
    throw new Error(`${name} must be a pinned direct dependency at ${version}`);
  }
}
const bundledBuildDependencies = {
  '@larksuiteoapi/node-sdk': '1.73.0',
  '@whiskeysockets/baileys': '7.0.0-rc14',
  'https-proxy-agent': '5.0.1',
};
for (const [name, version] of Object.entries(bundledBuildDependencies)) {
  if (manifest.dependencies?.[name] !== undefined) {
    throw new Error(`${name} must not remain a runtime dependency`);
  }
  if (manifest.devDependencies?.[name] !== version) {
    throw new Error(`${name} must be a pinned build dependency at ${version}`);
  }
}
if (lock.packages?.['node_modules/protobufjs']?.dev !== true) {
  throw new Error('protobufjs must remain build-only in the package lock');
}
if (manifest.bin?.['dsh-im'] !== 'bin/dsh-im.mjs') {
  throw new Error('package manifest must publish the dsh-im executable');
}
if (/(?:from\s*|import\s*\(|require\s*\()\s*["'](?:@larksuiteoapi\/node-sdk|@whiskeysockets\/baileys|https-proxy-agent|protobufjs)(?:\/[^"']*)?["']/.test(host)) {
  throw new Error('host bundle must not import a bundled SDK, proxy agent, or protobufjs at runtime');
}
if (!executable.isFile()) throw new Error('dsh-im CLI entry is not a regular file');
if (!/^#!\/usr\/bin\/env node(?:\r?\n|$)/u.test(executableSource)) {
  throw new Error('dsh-im CLI entry is missing the Node shebang');
}
if (process.platform !== 'win32' && (executable.mode & 0o111) === 0) {
  throw new Error('dsh-im CLI is not executable');
}
if (/private-bot-token|must-be-rolled-back|DEEPSEEK_API_KEY=/.test(client + host)) {
  throw new Error('built artifacts contain a test or environment secret marker');
}
await import(pathToFileURL(resolve(root, 'lib/index.js')).href);

console.log('Verified dsh-im package artifacts.');
