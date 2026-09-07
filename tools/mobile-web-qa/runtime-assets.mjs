/** Stage the shared, unmodified runtime graph; audit decompressed APK assets. */
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile, writeFile, readdir, mkdir, realpath, lstat, unlink } from 'node:fs/promises';
import { dirname, resolve, relative, isAbsolute, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const vendorRequire = createRequire(resolve(repo, 'vendor/chisacode-remote/package.json'));
const { build } = vendorRequire('esbuild');
const { parse } = vendorRequire('parse5');
const yauzl = vendorRequire('yauzl');
export const DEFAULT_SOURCE = resolve(repo, 'mobile/web');
export const MANIFEST = 'mobile-web-runtime-manifest.json';
const NATIVE_ASSETS = new Set([
  'mlkit_barcode_models/barcode_ssd_mobilenet_v1_dmp25_quant.tflite',
  'mlkit_barcode_models/oned_auto_regressor_mobile.tflite',
  'mlkit_barcode_models/oned_feature_extractor_mobile.tflite',
  'dexopt/baseline.prof', 'dexopt/baseline.profm',
]);
const hash = (body) => createHash('sha256').update(body).digest('hex');
const slash = (path) => path.replaceAll('\\', '/');
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;

function inside(root, path) {
  const rel = relative(root, path);
  return rel !== '..' && !rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) && !isAbsolute(rel);
}

export function isDevelopmentFile(path) {
  return /(^|\/)(?:\.[^/]+|node_modules|__tests__|__fixtures__|tests?|fixtures?|dev|coverage|results)(\/|$)/i.test(path)
    || /(?:\.(?:test|spec)\.[^/]+|\.map|\.md|\.ts|\.tsx)$/i.test(path)
    || /(^|\/)(?:package(?:-lock)?\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|entry\.mjs|fake[-.].*|.*\.config\.[^/]+)$/i.test(path);
}

async function safeFile(root, name) {
  if (!name || name.includes('\\') || name.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new Error(`Unsafe asset path: ${name}`);
  }
  const path = resolve(root, name);
  if (!inside(root, path) || !inside(await realpath(root), await realpath(path))) throw new Error(`Asset escapes source: ${name}`);
  if (!(await lstat(path)).isFile()) throw new Error(`Asset is not a regular file: ${name}`);
  return path;
}

function htmlReferences(body) {
  const refs = [];
  const visit = (node) => {
    const attrs = Object.fromEntries((node.attrs || []).map(({ name, value }) => [name, value]));
    if (attrs.src && ['script', 'img', 'audio', 'video', 'source', 'iframe'].includes(node.tagName)) refs.push(attrs.src);
    if (node.tagName === 'video' && attrs.poster) refs.push(attrs.poster);
    if (node.tagName === 'link' && attrs.href) refs.push(attrs.href);
    if (node.tagName === 'base' || attrs.srcset || (node.tagName === 'script' && !attrs.src && node.childNodes?.some((n) => n.value?.trim()))) {
      throw new Error('Runtime HTML requires external scripts and simple local asset references (no base/srcset)');
    }
    for (const child of node.childNodes || []) visit(child);
    if (node.content) visit(node.content);
  };
  visit(parse(body));
  return refs;
}

function localReference(specifier, importer) {
  if (/^(?:data:|#)/i.test(specifier)) return null;
  if (/^(?:[a-z]+:|\/)/i.test(specifier)) throw new Error(`Runtime dependency must be relative: ${specifier} in ${importer}`);
  const url = new URL(specifier, `https://assets.invalid/runtime/${importer}`);
  if (!url.pathname.startsWith('/runtime/')) throw new Error(`HTML asset escapes runtime root: ${specifier}`);
  return decodeURIComponent(url.pathname.slice('/runtime/'.length));
}

export async function runtimeManifest(source = DEFAULT_SOURCE) {
  source = await realpath(source);
  const files = new Map();
  const entries = [];
  const pending = ['index.html'];
  while (pending.length) {
    const name = pending.shift();
    if (files.has(name)) continue;
    if (isDevelopmentFile(name)) throw new Error(`Development file in runtime graph: ${name}`);
    const body = await readFile(await safeFile(source, name));
    files.set(name, body);
    if (extname(name) === '.html') {
      for (const ref of htmlReferences(body.toString())) {
        const next = localReference(ref, name);
        if (next) pending.push(next);
      }
    } else if (/\.(?:m?js|css)$/.test(name)) entries.push(name);
  }
  if (!entries.length) throw new Error('No runtime entrypoints found in index.html');
  const result = await build({
    absWorkingDir: source, entryPoints: entries, outdir: '__audit_only__',
    bundle: true, write: false, metafile: true, platform: 'browser', format: 'esm',
    treeShaking: false, logLevel: 'silent',
    logOverride: { 'unsupported-dynamic-import': 'error', 'unsupported-require-call': 'error' },
    loader: Object.fromEntries(['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico', '.woff', '.woff2', '.ttf', '.wasm'].map((ext) => [ext, 'file'])),
    plugins: [{ name: 'local-runtime-only', setup(builder) {
      builder.onResolve({ filter: /.*/ }, async ({ path, importer, kind }) => {
        if (/^(?:data:|#)/i.test(path) && kind === 'url-token') return { path, external: true };
        if (kind !== 'entry-point' && !path.startsWith('./') && !path.startsWith('../') && !['url-token', 'import-rule'].includes(kind)) {
          throw new Error(`Non-relative runtime import: ${path} in ${importer}`);
        }
        if (/^(?:[a-z]+:|\/)/i.test(path) && kind !== 'entry-point') throw new Error(`External runtime asset: ${path}`);
        // Native browser imports do not infer extensions or honor package.json remaps.
        const [plain] = path.split(/[?#]/, 1);
        const suffix = path.slice(plain.length);
        const absolute = resolve(importer ? dirname(importer) : source, decodeURIComponent(plain));
        const name = slash(relative(source, absolute));
        if (isDevelopmentFile(name)) throw new Error(`Development file in runtime graph: ${name}`);
        return { path: await safeFile(source, name), suffix };
      });
    } }],
  });
  for (const [input, meta] of Object.entries(result.metafile.inputs)) {
    const name = slash(input).split(/[?#]/, 1)[0];
    if (isDevelopmentFile(name)) throw new Error(`Development file in runtime graph: ${name}`);
    for (const dependency of meta.imports) {
      // esbuild adds its own virtual helper import when analyzing bundled CJS.
      if (dependency.external && dependency.path !== '<runtime>' && !/^(?:data:|#)/i.test(dependency.path)) throw new Error(`Unpackaged import: ${dependency.path}`);
    }
    files.set(name, await readFile(await safeFile(source, name)));
  }
  const manifest = { schemaVersion: 1, algorithm: 'sha256', entrypoints: ['index.html'], files: [...files]
    .sort(([a], [b]) => compare(a, b)).map(([path, body]) => ({ path, bytes: body.length, sha256: hash(body) })) };
  return { manifest, files };
}

const manifestBytes = (manifest) => Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);

async function directoryAssets(root) {
  const entries = new Map();
  async function visit(dir, prefix = '') {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const name = `${prefix}${entry.name}`;
      if (entry.isSymbolicLink()) throw new Error(`Symlink in assets: ${name}`);
      if (entry.isDirectory()) await visit(resolve(dir, entry.name), `${name}/`);
      else entries.set(name, await readFile(resolve(dir, entry.name)));
    }
  }
  await visit(root);
  return entries;
}

export async function stageAssets(source, output) {
  source = await realpath(source);
  output = resolve(output);
  if (inside(source, output) || inside(output, source)) throw new Error('Staging must be separate from the source tree');
  const { manifest, files } = await runtimeManifest(source);
  await mkdir(output, { recursive: true });
  if (await realpath(output) !== output) throw new Error('Staging output must not use symlinks or aliases');
  const existing = await directoryAssets(output);
  if (existing.size && !existing.has(MANIFEST)) throw new Error('Refusing to overwrite a non-staging directory');
  for (const [name, body] of files) {
    await mkdir(dirname(resolve(output, name)), { recursive: true });
    await writeFile(resolve(output, name), body);
  }
  for (const name of existing.keys()) {
    if (name !== MANIFEST && !files.has(name)) await unlink(await safeFile(output, name));
  }
  await writeFile(resolve(output, MANIFEST), manifestBytes(manifest));
  return manifest;
}

export function apkAssets(apk) {
  return new Promise((resolvePromise, reject) => {
    yauzl.open(apk, { lazyEntries: true }, (error, zip) => {
      if (error) return reject(error);
      const assets = new Map();
      const fail = (failure) => { zip.close(); reject(failure); };
      zip.on('error', fail);
      zip.on('end', () => resolvePromise(assets));
      zip.on('entry', (entry) => {
        if (!entry.fileName.startsWith('assets/') || entry.fileName.endsWith('/')) return zip.readEntry();
        const name = entry.fileName.slice(7);
        if (assets.has(name)) return fail(new Error(`Duplicate APK asset: ${name}`));
        zip.openReadStream(entry, (streamError, stream) => {
          if (streamError) return fail(streamError);
          const chunks = [];
          stream.on('error', fail);
          stream.on('data', (chunk) => chunks.push(chunk));
          stream.on('end', () => { assets.set(name, Buffer.concat(chunks)); zip.readEntry(); });
        });
      });
      zip.readEntry();
    });
  });
}

export async function auditAssets({ source = DEFAULT_SOURCE, apk, extracted }) {
  if (Boolean(apk) === Boolean(extracted)) throw new Error('Specify exactly one of --apk or --extracted (assets directory)');
  const { manifest } = await runtimeManifest(source);
  const actual = apk ? await apkAssets(apk) : await directoryAssets(extracted);
  const missing = [], changed = [], unexpected = [], nativeAssets = [];
  for (const file of manifest.files) {
    const body = actual.get(file.path);
    if (!body) missing.push(file.path);
    else if (body.length !== file.bytes || hash(body) !== file.sha256) changed.push(file.path);
  }
  if (!actual.has(MANIFEST)) missing.push(MANIFEST);
  else if (!actual.get(MANIFEST).equals(manifestBytes(manifest))) changed.push(MANIFEST);
  const expected = new Set([...manifest.files.map((file) => file.path), MANIFEST]);
  for (const name of actual.keys()) {
    if (NATIVE_ASSETS.has(name)) nativeAssets.push(name);
    else if (!expected.has(name)) unexpected.push(name);
  }
  return { pass: !missing.length && !changed.length && !unexpected.length, manifest,
    missing: missing.sort(compare), changed: changed.sort(compare), unexpected: unexpected.sort(compare), nativeAssets: nativeAssets.sort(compare),
    ...(apk ? { apk: resolve(apk), apkSha256: hash(await readFile(apk)) } : {}) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [command, ...args] = process.argv.slice(2);
    const { values } = parseArgs({ args, options: Object.fromEntries(['source', 'output', 'apk', 'extracted', 'report'].map((key) => [key, { type: 'string' }])) });
    const source = values.source || DEFAULT_SOURCE;
    let result;
    if (command === 'stage' && values.output) result = await stageAssets(source, values.output);
    else if (command === 'audit') result = await auditAssets({ source, apk: values.apk, extracted: values.extracted });
    else if (command === 'manifest') result = (await runtimeManifest(source)).manifest;
    else throw new Error('Usage: runtime-assets.mjs stage --output DIR | manifest | audit (--apk FILE | --extracted DIR) [--source DIR] [--report FILE]');
    if (values.report) {
      await mkdir(dirname(resolve(values.report)), { recursive: true });
      await writeFile(values.report, manifestBytes(result));
    }
    console.log(JSON.stringify(result, null, 2));
    if (result.pass === false) process.exitCode = 1;
  } catch (error) { console.error(error); process.exitCode = 1; }
}
