const { app, BrowserWindow, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');
const { assertMacReleaseIcon } = require('./check-mac-icon');

const root = path.join(__dirname, '..');
const assetsDir = path.join(root, 'assets');
const svgPath = path.join(assetsDir, 'icon.svg');
const pngPath = path.join(root, 'assets', 'icon.png');
const icoPath = path.join(root, 'assets', 'icon.ico');
const PNG_SIZE = 1024;
const SIZES = [16, 24, 32, 48, 64, 256];

function icoFromPngs(entries) {
  const count = entries.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(count, 4);
  let offset = 6 + 16 * count;
  const dir = [];
  for (const entry of entries) {
    const item = Buffer.alloc(16);
    item.writeUInt8(entry.width >= 256 ? 0 : entry.width, 0);
    item.writeUInt8(entry.height >= 256 ? 0 : entry.height, 1);
    item.writeUInt32LE(entry.png.length, 8);
    item.writeUInt32LE(offset, 12);
    item.writeUInt16LE(1, 4);
    item.writeUInt16LE(32, 6);
    dir.push(item);
    offset += entry.png.length;
  }
  return Buffer.concat([header, ...dir, ...entries.map((entry) => entry.png)]);
}

app.whenReady().then(async () => {
try {
  // Relative raster refs inside the svg (whale-head.png) are inlined as
  // data URIs — a data: document cannot reach back out to file://.
  const svg = fs.readFileSync(svgPath, 'utf8').replace(
    /href="([^"]+\.png)"/g,
    (match, rel) => `href="data:image/png;base64,${fs.readFileSync(path.join(assetsDir, rel)).toString('base64')}"`
  );
  const html = `<!DOCTYPE html><html><head><style>
    html,body{margin:0;width:${PNG_SIZE}px;height:${PNG_SIZE}px;background:transparent;overflow:hidden}
    svg{display:block;width:${PNG_SIZE}px;height:${PNG_SIZE}px}
  </style></head><body>${svg}</body></html>`;
  const win = new BrowserWindow({
    width: PNG_SIZE,
    height: PNG_SIZE,
    useContentSize: true,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: { offscreen: true },
  });
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  await new Promise((resolve) => setTimeout(resolve, 300));
  const image = await win.webContents.capturePage();
  const source = nativeImage.createFromBuffer(image.toPNG()).resize({
    width: PNG_SIZE,
    height: PNG_SIZE,
  });
  const png = source.toPNG();
  assertMacReleaseIcon(png, pngPath);
  fs.writeFileSync(pngPath, png);
  const entries = SIZES.map((size) => ({
    width: size,
    height: size,
    png: source.resize({ width: size, height: size }).toPNG(),
  }));
  fs.writeFileSync(icoPath, icoFromPngs(entries));
  process.stdout.write(`wrote ${pngPath}\nwrote ${icoPath}\n`);
  app.quit();
} catch (err) {
  console.error(err);
  app.exit(1);
}
});
