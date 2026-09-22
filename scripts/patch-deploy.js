// deploy 精简目录迭代补齐：运行 dsh web，解析缺失包并从 workspace/store 补齐，直到能启动
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.join(__dirname, '..');
const deploy = path.resolve(process.argv[2] || path.join(repoRoot, '.pack-v3'));
const vendorRoot = path.resolve(process.argv[3] || path.join(repoRoot, 'vendor', 'deepseek-harness'));
const MAX_ROUNDS = 30;
const skipped = new Set();

function findInStore(name) {
  // 在完整 store 找该包的条目目录（取第一个）
  const pnpm = path.join(vendorRoot, 'node_modules', '.pnpm');
  const prefix = name.startsWith('@') ? `${name.split('/')[0]}+${name.split('/')[1]}` : name;
  let entries = [];
  try {
    entries = fs.readdirSync(pnpm).filter((e) => e.startsWith(prefix + '@') || e.startsWith(prefix + '_'));
  } catch {
    return null;
  }
  if (!entries.length) return null;
  // 条目内真实内容：node_modules/<name>
  const pkgDir = path.join(pnpm, entries[0], 'node_modules', ...name.split('/'));
  return fs.existsSync(path.join(pkgDir, 'package.json')) ? pkgDir : null;
}

function copyPackage(name) {
  const dest = path.join(deploy, 'node_modules', ...name.split('/'));
  fs.rmSync(dest, { recursive: true, force: true });
  let src = null;
  // 1) workspace 包：packages/<group>/<pkg> 或 apps/<pkg>
  for (const base of ['packages', 'apps']) {
    const rootDir = path.join(vendorRoot, base);
    if (!fs.existsSync(rootDir)) continue;
    const scan = (dir) => {
      if (src) return;
      let pj;
      try {
        pj = path.join(dir, 'package.json');
        const p = JSON.parse(fs.readFileSync(pj, 'utf8'));
        if (p.name === name) src = dir;
      } catch {
        // fallthrough
      }
    };
    for (const g of fs.readdirSync(rootDir, { withFileTypes: true })) {
      if (!g.isDirectory()) continue;
      const first = path.join(rootDir, g.name);
      if (base === 'packages') {
        for (const s of fs.readdirSync(first, { withFileTypes: true })) {
          if (s.isDirectory()) scan(path.join(first, s.name));
        }
      } else {
        scan(first);
      }
    }
  }
  // 2) 本地 vendor 包源
  if (!src && fs.existsSync(path.join(vendorRoot, 'vendor', name.split('/')[1] || name))) {
    src = path.join(vendorRoot, 'vendor', name.split('/')[1]);
  }
  // 3) store
  if (!src) src = findInStore(name);

  if (!src) {
    console.log(`  ✗ 找不到 ${name} 的源码位置`);
    return false;
  }
  fs.mkdirSync(dest, { recursive: true });
  const skip = (s) => !s.endsWith('src') && !/tests?$/.test(s);
  for (const n of fs.readdirSync(src, { withFileTypes: true })) {
    if (!skip(n.name)) continue;
    try {
      fs.cpSync(path.join(src, n.name), path.join(dest, n.name), {
        recursive: true,
        dereference: true,
        // 只跳过包内嵌套 node_modules（相对路径判断，避免误过滤源路径本身）
        filter: (s) => !path.relative(src, s).split(path.sep).includes('node_modules'),
      });
    } catch (e) {
      console.log(`  ⚠ 复制 ${n.name} 失败: ${e.message}`);
    }
  }
  console.log(`  ✓ 已补齐 ${name}`);
  return true;
}

function runWeb() {
  const bin = path.join(deploy, 'lib', 'bin.js');
  // 用隔离的 DSH_HOME，避免串读用户级配置
  const home = path.join(deploy, '.dsh-home');
  const res = spawnSync(process.execPath, [bin, 'web', '--host', '127.0.0.1', '--port', '3081', '--no-open'], {
    cwd: deploy,
    timeout: 25000,
    encoding: 'utf8',
    env: { ...process.env, DSH_HOME: home, DSH_WEB_PORT: '3081' },
  });
  const out = (res.stdout || '') + '\n' + (res.stderr || '');
  // ETIMEDOUT = 进程存活到超时被杀（web 持续运行 = 启动成功）
  return { out, alive: Boolean(res.error && res.error.code === 'ETIMEDOUT') };
}

for (let round = 1; round <= MAX_ROUNDS; round += 1) {
  console.log(`=== 第 ${round} 轮 ===`);
  const { out, alive } = runWeb();
  // 支持包名与路径两种缺失形式（路径形式从 node_modules/<scope>/<pkg> 提取包名）
  const missing = [];
  for (const m of out.matchAll(/Cannot find (?:package|module) '([^']+)'/g)) {
    let name = m[1];
    const nmIdx = name.indexOf('node_modules');
    if (nmIdx >= 0) {
      const rest = name.slice(nmIdx + 'node_modules'.length + 1).replace(/\\/g, '/');
      const parts = rest.split('/');
      name = parts[0].startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0];
    }
    missing.push(name);
  }
  const unique = [...new Set(missing)].filter((n) => !skipped.has(n));
  if (!unique.length) {
    const fatal = out.match(/failed to (load|import|apply)|plugin tree failed/i);
    if (!fatal && alive) {
      console.log('✅ dsh web 启动成功（进程存活，插件树完整）');
      process.exit(0);
    }
    console.log(`⚠ 无新缺失但${fatal ? '有加载错误' : '进程未存活'}，继续迭代：\n${out.split('\n').slice(0, 8).join('\n')}`);
  } else {
    console.log(`缺失 ${unique.length} 个包: ${unique.join(', ')}`);
    for (const name of unique) {
      if (!copyPackage(name)) {
        skipped.add(name);
        console.log(`  → ${name} 无源可补，跳过（可能是平台限定包）`);
      }
    }
  }
}
console.log('❌ 超过最大轮数仍未收敛');
process.exit(1);
