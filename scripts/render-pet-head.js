// Generates assets/pet-head.png for the desktop-pet fallback only.
// Application branding is independently sourced from assets/whale-head.png.
//
// The source art ships an opaque black field, so the pass keys it out by
// luminance + saturation (her navy hair keeps saturation even where it is
// dark; the background is black and flat) before flattening onto white.
// Runs inside Electron (spawned via `npm run icon:pet`) for its canvas:
// plain node has no image decode. Re-run whenever the source art changes.
// `--diag` prints the luminance row-density profile of the source.
const { app, BrowserWindow, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const sourcePath = path.join(root, 'assets', 'whale-girl.jpg');
const headPngPath = path.join(root, 'assets', 'pet-head.png');

const TILE_PX = 512;
const ICON_RADIUS = 56;
const TILE_BG = '#FFFFFF';
// Fraction of the tile kept clear around the full-body art.
const TILE_INSET = 0.04;
// Black-key ramps: background pixels are dim AND unsaturated; character
// pixels are bright (skin, white cloth) or saturated (navy hair, blue tail).
const KEY_BRIGHT_LO = 22;
const KEY_BRIGHT_HI = 64;
const KEY_SAT_LO = 14;
const KEY_SAT_HI = 44;

app.whenReady().then(async () => {
  const diag = process.argv.includes('--diag');
  const win = new BrowserWindow({
    width: TILE_PX,
    height: TILE_PX,
    useContentSize: true,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: { offscreen: true },
  });
  const dataUrl = `data:image/jpeg;base64,${fs.readFileSync(sourcePath).toString('base64')}`;
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(
    `<!DOCTYPE html><html><body style="margin:0;overflow:hidden"><canvas id="c" width="${TILE_PX}" height="${TILE_PX}"></canvas></body></html>`
  )}`);

  const params = JSON.stringify({
    tile: TILE_PX,
    radius: Math.round((ICON_RADIUS / 256) * TILE_PX),
    bg: TILE_BG,
    inset: TILE_INSET,
    key: { bLo: KEY_BRIGHT_LO, bHi: KEY_BRIGHT_HI, sLo: KEY_SAT_LO, sHi: KEY_SAT_HI },
    diag,
  });
  const result = await win.webContents.executeJavaScript(`new Promise((resolve) => {
    const P = ${params};
    const img = new Image();
    img.onload = () => {
      const c = document.getElementById('c');
      const ctx = c.getContext('2d');
      if (P.diag) {
        ctx.drawImage(img, 0, 0, c.width, c.height);
        const d = ctx.getImageData(0, 0, c.width, c.height);
        const rows = [];
        for (let y = 0; y < d.height; y++) {
          let rowMin = d.width, rowMax = -1;
          for (let x = 0; x < d.width; x++) {
            const o = (y * d.width + x) * 4;
            const lit = d.data[o + 3] > 12 && (d.data[o] + d.data[o + 1] + d.data[o + 2]) / 3 > 24;
            if (lit) {
              if (x < rowMin) rowMin = x;
              if (x > rowMax) rowMax = x;
            }
          }
          if (rowMax >= 0) rows.push({ y, lo: rowMin, hi: rowMax });
        }
        resolve({ diag: true, w: img.naturalWidth, h: img.naturalHeight, rows });
        return;
      }

      // 1. Key the character out of the black field.
      const key = document.createElement('canvas');
      key.width = img.naturalWidth;
      key.height = img.naturalHeight;
      const kx = key.getContext('2d');
      kx.drawImage(img, 0, 0);
      const px = kx.getImageData(0, 0, key.width, key.height);
      const ramp = (v, lo, hi) => Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
      for (let i = 0; i < px.data.length; i += 4) {
        const r = px.data[i], g = px.data[i + 1], b = px.data[i + 2];
        const m = Math.max(r, g, b);
        const s = m - Math.min(r, g, b);
        px.data[i + 3] = Math.round(255 * Math.max(ramp(m, P.key.bLo, P.key.bHi), ramp(s, P.key.sLo, P.key.sHi)));
      }
      kx.putImageData(px, 0, 0);

      // 2. White rounded tile + full-body character inside a small inset.
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.beginPath();
      ctx.roundRect(0, 0, c.width, c.height, P.radius);
      ctx.fillStyle = P.bg;
      ctx.fill();
      ctx.save();
      ctx.clip();
      const inset = Math.round(c.width * P.inset);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(key, inset, inset, c.width - inset * 2, c.height - inset * 2);
      ctx.restore();
      resolve({ ok: true });
    };
    img.onerror = () => resolve({ error: 'load failed' });
    img.src = ${JSON.stringify(dataUrl)};
  })`);
  if (result.error) {
    console.error(result.error);
    app.exit(1);
    return;
  }
  if (result.diag) {
    console.log(`source ${result.w}x${result.h} luminance rows:`);
    for (const row of result.rows) {
      console.log(String(row.y).padStart(3), String(row.lo).padStart(3), String(row.hi).padStart(3), 'w=' + (row.hi - row.lo + 1));
    }
    app.quit();
    return;
  }

  const shot = await win.webContents.capturePage();
  const tile = nativeImage.createFromBuffer(shot.toPNG()).resize({ width: TILE_PX, height: TILE_PX });
  fs.writeFileSync(headPngPath, tile.toPNG());
  console.log(`wrote ${headPngPath}`);

  app.quit();
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
