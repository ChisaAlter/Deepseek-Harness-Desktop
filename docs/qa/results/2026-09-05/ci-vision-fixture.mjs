import fs from 'node:fs';
import path from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import { evidenceDir } from './ci-production-cdp.mjs';

const width = 320;
const height = 160;
const second = process.argv[2] === 'second';
const pixels = Buffer.alloc((width * 3 + 1) * height, 255);
for (let y = 0; y < height; y++) {
  pixels[y * (width * 3 + 1)] = 0;
  for (let x = 0; x < width; x++) {
    let rgb = [255, 255, 255];
    if (x >= 28 && x < 116 && y >= 36 && y < 124) rgb = second ? [20, 190, 50] : [230, 20, 30];
    if ((x - 240) ** 2 + (y - 80) ** 2 <= 44 ** 2) rgb = second ? [245, 210, 10] : [20, 60, 230];
    const offset = y * (width * 3 + 1) + 1 + x * 3;
    rgb.forEach((value, i) => { pixels[offset + i] = value; });
  }
}
function chunk(name, data) {
  const body = Buffer.concat([Buffer.from(name), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, checksum]);
}
const header = Buffer.alloc(13);
header.writeUInt32BE(width);
header.writeUInt32BE(height, 4);
header[8] = 8;
header[9] = 2;
const image = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
fs.writeFileSync(path.join(evidenceDir, second ? 'vision-fixture-second.png' : 'vision-fixture.png'), image);
const workspaceFile = second ? 'C:/Ai/ChisaTerminal/qa-vision-second-33942243475.png' : 'C:/Ai/ChisaTerminal/qa-vision-33942243475.png';
if (fs.existsSync(workspaceFile) && !fs.readFileSync(workspaceFile).equals(image)) throw new Error('Refusing to replace existing fixture path');
fs.writeFileSync(workspaceFile, image);
console.log(second ? 'Created second fixture: green square left, yellow circle right.' : 'Created first fixture: red square left, blue circle right.');
