#!/usr/bin/env node
/*
 * Wrap the electron-builder NSIS Setup into the branded installer:
 *
 *   dist/Deepseek-Harness-Desktop-Setup-<v>.exe  (electron-builder output)
 *     -> renamed to a non-.exe staging name so release globs never see it
 *   build/dsh-setup-stub.exe                      (build-installer-stub.mjs)
 *
 *   final = [stub image][payload][manifest JSON][u32 manifestLen]["DSHSTUB\x01"]
 *
 * The tail format is read by installer/stub.c — keep both sides in sync.
 * After wrapping, the .blockmap sidecar is regenerated with app-builder-lib's
 * buildBlockMap so the uploaded blockmap matches the shipped bytes.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const TAIL_MAGIC = Buffer.from('DSHSTUB\x01', 'latin1');

export function buildTail(manifest) {
  const json = Buffer.from(JSON.stringify(manifest), 'utf8');
  const len = Buffer.alloc(4);
  len.writeUInt32LE(json.length, 0);
  return Buffer.concat([json, len, TAIL_MAGIC]);
}

/** Parse the tail off a wrapped exe buffer. Returns null for unwrapped files. */
export function parseTail(buf) {
  if (buf.length < 12) return null;
  const magic = buf.subarray(buf.length - TAIL_MAGIC.length);
  if (!magic.equals(TAIL_MAGIC)) return null;
  const manifestLen = buf.readUInt32LE(buf.length - TAIL_MAGIC.length - 4);
  if (manifestLen <= 0 || manifestLen > 8192) return null;
  const start = buf.length - TAIL_MAGIC.length - 4 - manifestLen;
  if (start < 0) return null;
  const manifest = JSON.parse(buf.toString('utf8', start, start + manifestLen));
  const payloadOfs = start - manifest.payloadLen;
  if (payloadOfs < 0) return null;
  return { manifest, payloadOfs, payloadLen: manifest.payloadLen };
}

/** Byte total + file count of an installed tree (the progress denominator). */
export function collectDirStats(dir) {
  let bytes = 0;
  let files = 0;
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    for (const entry of fs.readdirSync(cur, { withFileTypes: true })) {
      const full = path.join(cur, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile()) {
        files += 1;
        bytes += fs.statSync(full).size;
      }
    }
  }
  return { bytes, files };
}

export async function wrapSetup({ stubPath, innerPath, unpackedDir, outPath, manifest }) {
  const stats = collectDirStats(unpackedDir);
  const stub = fs.readFileSync(stubPath);
  const payload = fs.readFileSync(innerPath);
  if (parseTail(payload)) {
    throw new Error(`${innerPath} is already a wrapped installer — refusing to nest`);
  }
  const tail = buildTail({ payloadLen: payload.length, installBytes: stats.bytes, ...manifest });
  const tmp = `${outPath}.wrap-tmp`;
  fs.writeFileSync(tmp, Buffer.concat([stub, payload, tail]));
  fs.renameSync(tmp, outPath);
  const { buildBlockMap } = await import(
    pathToFileURL(
      path.join(ROOT, 'node_modules', 'app-builder-lib', 'out', 'targets', 'blockmap', 'blockmap.js')
    ).href
  );
  // Same parameters electron-builder uses for the .blockmap sidecar.
  await buildBlockMap(outPath, 'gzip', `${outPath}.blockmap`);
  return { outBytes: fs.statSync(outPath).size, installBytes: stats.bytes };
}

async function main() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const distDir = path.join(ROOT, 'dist');
  const artifact = path.join(distDir, `Deepseek-Harness-Desktop-Setup-${pkg.version}.exe`);
  if (!fs.existsSync(artifact)) {
    throw new Error(`electron-builder output not found: ${artifact} (run electron-builder first)`);
  }

  const stub = path.join(ROOT, 'build', 'dsh-setup-stub.exe');
  if (!fs.existsSync(stub)) {
    execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'build-installer-stub.mjs')], {
      stdio: 'inherit',
    });
  }

  // Staging name deliberately lacks .exe so `Setup-*.exe` globs never pick it.
  // Idempotent: a previously wrapped artifact yields its inner payload again.
  const inner = path.join(distDir, '.dsh-inner-setup.bin');
  {
    const current = fs.readFileSync(artifact);
    const parsed = parseTail(current);
    if (parsed) {
      fs.writeFileSync(inner, current.subarray(parsed.payloadOfs, parsed.payloadOfs + parsed.payloadLen));
      fs.rmSync(artifact);
    } else {
      fs.renameSync(artifact, inner);
    }
  }
  try {
    const result = await wrapSetup({
      stubPath: stub,
      innerPath: inner,
      unpackedDir: path.join(distDir, 'win-unpacked'),
      outPath: artifact,
      manifest: {
        v: 1,
        productName: pkg.build.productName,
        version: pkg.version,
        exeName: `${pkg.build.productName}.exe`,
      },
    });
    fs.rmSync(inner, { force: true });
    console.log(
      `wrapped ${path.basename(artifact)} ` +
        `(${(result.outBytes / 1024 / 1024).toFixed(1)} MiB, ` +
        `installBytes=${result.installBytes})`
    );
  } catch (error) {
    /* Restore the untouched NSIS artifact so the step can be retried. */
    if (fs.existsSync(inner)) fs.renameSync(inner, artifact);
    throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
}
