// 递归闭包对齐：deploy 顶层与 vendor 的 cli 依赖闭包保持一致。
// include 加载的插件及其依赖（@deepseek-ai/*、vendor 本地包、registry 包）
// 全部补到 deploy 顶层；闭包外的包保持缺失（cordis include 跳过找不到的插件，
// 与完整环境行为一致）。
const fs = require('fs');
const path = require('path');

const vendorRoot = path.resolve(__dirname, '..', 'vendor', 'deepseek-harness');
const deploy = path.resolve(process.argv[2] || '.pack-v4');

function findPkg(name) {
  // 1) workspace 包源：packages/<group>/<pkg> 或 apps/<pkg>
  for (const base of ['packages', 'apps']) {
    const b = path.join(vendorRoot, base);
    if (!fs.existsSync(b)) continue;
    for (const g of fs.readdirSync(b, { withFileTypes: true })) {
      if (!g.isDirectory()) continue;
      const first = path.join(b, g.name);
      const dirs = base === 'packages'
        ? fs.readdirSync(first, { withFileTypes: true })
            .filter((x) => x.isDirectory())
            .map((x) => path.join(first, x.name))
        : [first];
      for (const d of dirs) {
        try {
          const pj = path.join(d, 'package.json');
          if (JSON.parse(fs.readFileSync(pj, 'utf8')).name === name) {
            return d;
          }
        } catch {
          // fallthrough
        }
      }
    }
  }
  // 2) 本地 vendor 包源（cordis 插件等）
  const local = path.join(vendorRoot, 'vendor', name.split('/')[1] || name);
  if (fs.existsSync(path.join(local, 'package.json'))) {
    return local;
  }
  // 3) store
  const pnpm = path.join(vendorRoot, 'node_modules', '.pnpm');
  const prefix = name.startsWith('@')
    ? name.split('/')[0] + '+' + name.split('/')[1]
    : name;
  let entries = [];
  try {
    entries = fs.readdirSync(pnpm).filter((e) => e.startsWith(prefix + '@') || e.startsWith(prefix + '_'));
  } catch {
    return null;
  }
  for (const e of entries) {
    const pkgDir = path.join(pnpm, e, 'node_modules', ...name.split('/'));
    if (fs.existsSync(path.join(pkgDir, 'package.json'))) {
      return pkgDir;
    }
  }
  return null;
}

function copyPkg(name, src) {
  const dest = path.join(deploy, 'node_modules', ...name.split('/'));
  if (fs.existsSync(path.join(dest, 'package.json'))) {
    return 'exists';
  }
  fs.mkdirSync(dest, { recursive: true });
  for (const n of fs.readdirSync(src, { withFileTypes: true })) {
    if (n.name === 'node_modules' || n.name === 'src' || /^tests?$/.test(n.name)) {
      continue;
    }
    try {
      fs.cpSync(path.join(src, n.name), path.join(dest, n.name), {
        recursive: true,
        dereference: true,
        filter: (s) => !path.relative(src, s).split(path.sep).includes('node_modules'),
      });
    } catch (e) {
      console.log(`  ⚠ 复制 ${n.name} 失败: ${e.message.slice(0, 60)}`);
    }
  }
  return 'copied';
}

const queue = [];
const done = new Set();
const failed = new Set();

// 种子：vendor 的 cli 包内嵌套 @deepseek-ai（cli 直接依赖闭包）
for (const n of fs.readdirSync(path.join(vendorRoot, 'apps', 'cli', 'node_modules', '@deepseek-ai'))) {
  queue.push(`@deepseek-ai/${n.replace(/@$/, '')}`);
}

let copied = 0;
while (queue.length) {
  const name = queue.shift();
  if (done.has(name)) continue;
  done.add(name);
  const dest = path.join(deploy, 'node_modules', ...name.split('/'));
  if (!fs.existsSync(path.join(dest, 'package.json'))) {
    const src = findPkg(name);
    if (!src) {
      failed.add(name);
      console.log(`  ✗ 找不到源: ${name}`);
      continue;
    }
    const result = copyPkg(name, src);
    if (result === 'copied') {
      copied += 1;
      console.log(`  ✓ 已补齐 ${name}`);
    }
  }
  // 无论是否已存在，都递归它的依赖（缺失的入队补齐）
  try {
    const pj = JSON.parse(fs.readFileSync(path.join(dest, 'package.json'), 'utf8'));
    for (const dep of Object.keys(pj.dependencies || {})) {
      if (!done.has(dep)) {
        queue.push(dep);
      }
    }
  } catch {
    // fallthrough
  }
}
console.log(`闭包对齐完成: 补齐 ${copied} 个，找不到源 ${failed.size} 个（${[...failed].join(', ')}）`);
