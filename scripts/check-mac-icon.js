'use strict';

const fs = require('node:fs');
const path = require('node:path');

const MIN_MAC_ICON_PX = 512;
const DEFAULT_ICON = path.join(__dirname, '..', 'assets', 'icon.png');

function inspectPng(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 24 || buf.subarray(1, 4).toString('ascii') !== 'PNG') {
    throw new Error('file is not a PNG');
  }
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function assertMacReleaseIcon(buf, label = 'icon PNG') {
  const { width, height } = inspectPng(buf);
  if (width < MIN_MAC_ICON_PX || height < MIN_MAC_ICON_PX) {
    throw new Error(
      `${label} is ${width}x${height}; electron-builder requires at least ${MIN_MAC_ICON_PX}x${MIN_MAC_ICON_PX} for macOS`,
    );
  }
  return { width, height };
}

function main(file = DEFAULT_ICON) {
  const size = assertMacReleaseIcon(fs.readFileSync(file), file);
  process.stdout.write(`${file}: ${size.width}x${size.height}\n`);
}

if (require.main === module) {
  try {
    main(process.argv[2]);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
}

module.exports = { MIN_MAC_ICON_PX, inspectPng, assertMacReleaseIcon };
