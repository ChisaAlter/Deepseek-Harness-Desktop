'use strict';

const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const inputCss = fs.readFileSync(path.join(
  root,
  'vendor/deepseek-harness/packages/client/ui-conversation/src/client/skeleton/InputBar.module.css',
), 'utf8');
const beamCss = fs.readFileSync(path.join(
  root,
  'vendor/deepseek-harness/packages/client/ui-conversation/src/client/ComposerBeam.module.css',
), 'utf8');
const angles = Array.from({ length: 24 }, (_, index) => index * 15);
const cornerCss = fs.readFileSync(path.join(root,
  'vendor/deepseek-harness/packages/client/ui-theme/src/styles/corner-shape.css'), 'utf8');
const elevationCss = fs.readFileSync(path.join(root,
  'vendor/deepseek-harness/packages/client/ui-theme/src/styles/gradient-shadow-text.css'), 'utf8');
const cornerNames = ['top-left', 'top-right', 'bottom-right', 'bottom-left'];
const strokePixelThreshold = 32;
const strokePeakCoverageThreshold = 0.9;
const strokeDarkCoverageThreshold = 0.25;
const bloomPixelThreshold = 1;
const cardWidth = Number(app.commandLine.getSwitchValue('card-width') || 654);
const cardHeight = Number(app.commandLine.getSwitchValue('card-height') || 193);
const viewportWidth = Number(app.commandLine.getSwitchValue('viewport-width') || 1000);
let pixelScale = 1;

const paletteColors = {
  legacy: ['#ff3264', '#288cff', '#32c850', '#1eb9aa', '#6446ff', '#ff7828', '#f032b4'],
  warm: ['#ff4d6d', '#ff8c42', '#ffd166', '#ef476f', '#ff4d6d'],
  aurora: ['#42e8c8', '#3f8cff', '#8a5cf6', '#e45bff', '#42e8c8'],
  rose: ['#ff4f81', '#ff79c6', '#c77dff', '#7b61ff', '#ff4f81'],
  glacier: ['#d9f7ff', '#6edff6', '#328bff', '#5b6dff', '#d9f7ff'],
  cyber: ['#00f0ff', '#00ff8f', '#b6ff00', '#ffed00', '#00f0ff'],
  sunset: ['#ff5f6d', '#ffc371', '#ff9a8b', '#ff6a88', '#ff5f6d'],
  cyan: ['#31d7ff', '#1eb9aa', '#64a8ff', '#31d7ff'],
};

const beamVariableNames = [
  '--dsh-composer-beam-palette-gradient',
  '--dsh-composer-beam-inner-gradient',
  '--dsh-composer-beam-bloom-gradient',
  '--dsh-composer-beam-inner-shadow',
  '--dsh-composer-beam-track-width',
  '--dsh-composer-beam-glow-blur',
  '--dsh-composer-beam-hue-cycle-range',
  '--dsh-composer-beam-hue-cycle-period',
  '--dsh-composer-beam-breathing-amplitude',
  '--dsh-composer-beam-breathing-period',
  '--dsh-composer-beam-night-factor',
  '--dsh-composer-beam-easing',
];

function paletteGradient(colors) {
  const closed = colors[colors.length - 1] === colors[0] ? colors : [...colors, colors[0]];
  const stops = closed.map((color, index) => `${color} ${(index / (closed.length - 1) * 100).toFixed(2)}%`).join(', ');
  return `conic-gradient(from var(--dsh-composer-beam-angle), ${stops})`;
}

function innerGradient(colors) {
  const at = (index, alpha) => `${colors[index % colors.length]}${alpha}`;
  return [
    `radial-gradient(ellipse 180px 32px at 74% 100%, ${at(0, '6b')}, transparent)`,
    `radial-gradient(ellipse 74px 32px at 94% 0%, ${at(1, '61')}, transparent)`,
    `radial-gradient(ellipse 80px 40px at 6% 0%, ${at(2, '66')}, transparent)`,
    `radial-gradient(ellipse 90px 45px at 20% 0%, ${at(3, '5c')}, transparent)`,
  ].join(', ');
}

function bloomGradient(colors) {
  return `conic-gradient(from var(--dsh-composer-beam-angle), transparent 0%, transparent 58%, rgba(255, 255, 255, 0.08) 64%, ${colors[0]}8c 69%, ${colors[1 % colors.length]}b3 70.5%, ${colors[0]}73 73%, transparent 82%, transparent 100%)`;
}

function customBeamOptions(colors) {
  return {
    direction: 'pingPong',
    breathing: 'on',
    hueCycle: 'off',
    variables: {
      '--dsh-composer-beam-palette-gradient': paletteGradient(colors),
      '--dsh-composer-beam-inner-gradient': innerGradient(colors),
      '--dsh-composer-beam-bloom-gradient': bloomGradient(colors),
      '--dsh-composer-beam-inner-shadow': `inset 0 0 18px 3px ${colors[0]}66, inset 0 0 42px 10px ${colors[colors.length - 1]}33`,
      '--dsh-composer-beam-track-width': '4px',
      '--dsh-composer-beam-glow-blur': '0px',
      '--dsh-composer-beam-hue-cycle-range': '0deg',
      '--dsh-composer-beam-hue-cycle-period': '1s',
      '--dsh-composer-beam-breathing-amplitude': '0.3',
      '--dsh-composer-beam-breathing-period': '1s',
      '--dsh-composer-beam-night-factor': '0.5',
      '--dsh-composer-beam-easing': 'ease-in-out',
    },
  };
}

app.disableHardwareAcceleration();

function pixel(buffer, width, x, y) {
  const offset = (Math.round(y * pixelScale) * width + Math.round(x * pixelScale)) * 4;
  return [buffer[offset + 2], buffer[offset + 1], buffer[offset]];
}

function difference(a, b) {
  return Math.max(
    Math.abs(a[0] - b[0]),
    Math.abs(a[1] - b[1]),
    Math.abs(a[2] - b[2]),
  );
}

function cornerAngles(corner) {
  const start = corner === 'top-left' ? 185
    : corner === 'top-right' ? 275
      : corner === 'bottom-right' ? 5
        : 95;
  return Array.from({ length: 17 }, (_, index) => start + index * 5);
}

function cornerCenter(rect, corner) {
  const radius = 22;
  return {
    x: corner.includes('left') ? rect.x + radius : rect.x + rect.width - radius,
    y: corner.includes('top') ? rect.y + radius : rect.y + rect.height - radius,
  };
}

function cornerArcSamples(rect, corner) {
  const radius = 22;
  const center = cornerCenter(rect, corner);
  return cornerAngles(corner).map((angle) => {
    const radians = angle * Math.PI / 180;
    return [-1.5, -1, -0.5, 0, 0.5].map((offset) => [
      center.x + (radius + offset) * Math.cos(radians),
      center.y + (radius + offset) * Math.sin(radians),
    ]);
  });
}

function cornerExteriorSamples(rect, corner) {
  const radius = 22;
  const center = cornerCenter(rect, corner);
  const points = [];
  for (const angle of cornerAngles(corner)) {
    const radians = angle * Math.PI / 180;
    for (let offset = 1; offset <= 4; offset += 1) {
      points.push([
        center.x + (radius + offset) * Math.cos(radians),
        center.y + (radius + offset) * Math.sin(radians),
      ]);
    }
  }
  return points;
}

async function capturePage(window) {
  let lastError;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await window.webContents.capturePage();
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw lastError;
}

async function capture(window, angle, active, mode, options = {}) {
  const styleReset = beamVariableNames.map((name) => `beam.style.removeProperty(${JSON.stringify(name)});`).join('');
  const styleSet = Object.entries(options.variables || {})
    .map(([name, value]) => `beam.style.setProperty(${JSON.stringify(name)}, ${JSON.stringify(value)});`)
    .join('');
  const failure = await window.webContents.executeJavaScript(`
    (() => {
      try {
        document.documentElement.style.setProperty('--test-angle', '${angle}deg');
        document.body.dataset.mode = '${mode}';
        const beam = document.querySelector('.beamLayer');
        ${styleReset}
        ${styleSet}
        beam.dataset.beamDirection = ${JSON.stringify(options.direction || 'clockwise')};
        beam.dataset.beamBreathing = ${JSON.stringify(options.breathing || 'off')};
        beam.dataset.beamHueCycle = ${JSON.stringify(options.hueCycle || 'on')};
        document.querySelector('.card').classList.toggle('cardBeam', ${active});
        return null;
      } catch (error) {
        return { message: String(error), stack: error instanceof Error ? error.stack : '' };
      }
    })()
  `);
  if (failure !== null) throw new Error(`capture fixture failed: ${failure.message}\n${failure.stack || ''}`);
  await new Promise((resolve) => setTimeout(resolve, 80));
  return capturePage(window);
}

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    width: viewportWidth,
    height: 420,
    frame: false,
    useContentSize: true,
    show: false,
    webPreferences: {
      backgroundThrottling: false,
      partition: 'composer-beam-corners',
    },
  });
  const html = `<!doctype html>
    <html>
      <head>
        <meta charset="utf-8">
        <style>
          :root {
            --dsh-composer-card-max-width: ${cardWidth}px;
            --dsw-specific-input-major: rgba(44, 44, 46, 0.7);
            --dsw-alias-border-l2: rgba(255, 255, 255, 0.16);
            --dsw-font-family: sans-serif;
            --dsw-alias-scrollbar-bg-l2: rgba(255, 255, 255, 0.12);
            --dsw-alias-scrollbar-hover-l2: rgba(255, 255, 255, 0.2);
          }
          html, body {
            margin: 0;
            width: 100%;
            height: 100%;
            background:
              linear-gradient(118deg, rgb(91, 48, 61) 0 20%, rgb(18, 81, 111) 20% 37%, rgb(126, 69, 99) 37% 54%, rgb(25, 29, 36) 54% 73%, rgb(92, 28, 83) 73% 100%);
          }
          body { display: grid; place-items: center; }
          ${cornerCss}
          ${elevationCss}
          ${inputCss}
          ${beamCss}
          .card { width: ${cardWidth}px; max-width: ${cardWidth}px; }
          .cardBody { height: ${cardHeight - 10}px; }
          .cardBeam { animation: none !important; --dsh-composer-beam-angle: var(--test-angle); }
          .beamInner, .beamStroke, .beamBloom { animation: none !important; transition: none !important; }
          .beamStroke { filter: hue-rotate(var(--test-hue, -30deg)) brightness(1.3) saturate(1.2) !important; }
          body[data-mode='stroke'] .beamInner, body[data-mode='stroke'] .beamBloom { display: none !important; }
          body[data-mode='bloom'] .beamInner, body[data-mode='bloom'] .beamStroke { display: none !important; }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="beamLayer cardBeam" data-beam-direction="clockwise">
            <span class="beamInner"></span>
            <span class="beamStroke"></span>
            <span class="beamBloom"></span>
          </div>
          <div class="cardBody"></div>
        </div>
      </body>
    </html>`;
  await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  const rect = await window.webContents.executeJavaScript(`
    (() => {
      const { x, y, width, height } = document.querySelector('.card').getBoundingClientRect();
      return { x, y, width, height };
    })()
  `);
  const geometry = await window.webContents.executeJavaScript(`
    ['.card', '.beamLayer', '.beamInner', '.beamStroke', '.beamBloom'].map(selector => ({
      selector,
      corner: getComputedStyle(document.querySelector(selector), selector === '.beamBloom' ? '::before' : null).cornerShape,
    }))
  `);
  const geometryFailures = geometry.filter(({ corner }) => corner && corner !== 'round');
  const strokeBaselineImage = await capture(window, 0, false, 'stroke');
  const strokeBaseline = strokeBaselineImage.toBitmap({ scaleFactor: 1 });
  const captureSize = strokeBaselineImage.getSize(1);
  pixelScale = captureSize.width / window.getContentSize()[0];
  if (strokeBaseline.length !== captureSize.width * captureSize.height * 4) {
    throw new Error('Capture dimensions do not match the pixel buffer');
  }
  await window.webContents.executeJavaScript(`
    document.querySelector('.card').style.boxShadow = 'var(--dsw-elevation-stroke)';
  `);
  const noRim = (await capture(window, 0, false, 'stroke')).toBitmap({ scaleFactor: 1 });
  await window.webContents.executeJavaScript(`document.querySelector('.card').style.removeProperty('box-shadow')`);
  const rimCoverage = Object.fromEntries(cornerNames.map((corner) => {
    const center = cornerCenter(rect, corner);
    const visible = cornerAngles(corner).filter((angle) => {
      const radians = angle * Math.PI / 180;
      const x = center.x + 16 * Math.cos(radians);
      const y = center.y + 16 * Math.sin(radians);
      return difference(pixel(strokeBaseline, captureSize.width, x, y),
        pixel(noRim, captureSize.width, x, y)) >= 3;
    }).length;
    return [corner, visible / 17];
  }));
  const rimFailures = cornerNames.filter((name) => rimCoverage[name] < 0.9);
  const minimumCoverage = Object.fromEntries(cornerNames.map((name) => [name, 1]));
  const maximumCoverage = Object.fromEntries(cornerNames.map((name) => [name, 0]));
  const minimumAngles = Object.fromEntries(cornerNames.map((name) => [name, 0]));
  const maximumAngles = Object.fromEntries(cornerNames.map((name) => [name, 0]));

  // The production hue cycle changes low-contrast filament colors independently
  // of rotation. Check both extrema without weakening the visibility threshold.
  for (const { angle, hue } of angles.flatMap(angle => [-30, 30].map(hue => ({ angle, hue })))) {
    await window.webContents.executeJavaScript(`document.documentElement.style.setProperty('--test-hue', '${hue}deg')`);
    const activeImage = await capture(window, angle, true, 'stroke');
    const active = activeImage.toBitmap({ scaleFactor: 1 });
    for (const corner of cornerNames) {
      const arcs = cornerArcSamples(rect, corner);
      const visible = arcs.filter(points => points.some(([x, y]) => difference(
        pixel(active, captureSize.width, x, y),
        pixel(strokeBaseline, captureSize.width, x, y),
      ) >= strokePixelThreshold)).length;
      const coverage = visible / arcs.length;
      if (coverage < minimumCoverage[corner]) {
        minimumCoverage[corner] = coverage;
        minimumAngles[corner] = angle;
      }
      if (coverage > maximumCoverage[corner]) {
        maximumCoverage[corner] = coverage;
        maximumAngles[corner] = angle;
      }
    }
  }

  const bloomBaselineImage = await capture(window, 0, false, 'bloom');
  const bloomBaseline = bloomBaselineImage.toBitmap({ scaleFactor: 1 });
  const bloomMaxima = Object.fromEntries(cornerNames.map((name) => [name, 0]));
  for (const angle of angles) {
    const activeImage = await capture(window, angle, true, 'bloom');
    const active = activeImage.toBitmap({ scaleFactor: 1 });
    for (const corner of cornerNames) {
      for (const [x, y] of cornerExteriorSamples(rect, corner)) {
        const delta = difference(
          pixel(active, captureSize.width, x, y),
          pixel(bloomBaseline, captureSize.width, x, y),
        );
        bloomMaxima[corner] = Math.max(bloomMaxima[corner], delta);
      }
    }
  }

  const finalImage = await capture(window, 0, true, 'full');
  fs.mkdirSync(path.join(root, '.tmp'), { recursive: true });
  fs.writeFileSync(path.join(root, '.tmp', 'composer-beam-corners.png'), finalImage.toPNG());
  const strokePeakFailures = cornerNames.filter((name) => maximumCoverage[name] < strokePeakCoverageThreshold);
  const strokeMotionFailures = cornerNames.filter((name) => minimumCoverage[name] > strokeDarkCoverageThreshold);
  const bloomFailures = cornerNames.filter((name) => bloomMaxima[name] < bloomPixelThreshold);
  const paletteVisibility = {};
  for (const [name, colors] of Object.entries(paletteColors)) {
    const paletteImage = await capture(window, 135, true, 'palette', customBeamOptions(colors));
    const palette = paletteImage.toBitmap({ scaleFactor: 1 });
    let maximumDelta = 0;
    for (let y = Math.max(0, Math.floor(rect.y - 5)); y < Math.min(captureSize.height, Math.ceil(rect.y + rect.height + 5)); y += 2) {
      for (let x = Math.max(0, Math.floor(rect.x - 5)); x < Math.min(captureSize.width, Math.ceil(rect.x + rect.width + 5)); x += 2) {
        maximumDelta = Math.max(maximumDelta, difference(
          pixel(palette, captureSize.width, x, y),
          pixel(strokeBaseline, captureSize.width, x, y),
        ));
      }
    }
    paletteVisibility[name] = maximumDelta;
  }
  const paletteFailures = Object.keys(paletteVisibility).filter((name) => paletteVisibility[name] < strokePixelThreshold);
  const report = {
    card: rect,
    pixelScale,
    geometry: { layers: geometry, failures: geometryFailures },
    rim: { coverage: rimCoverage, failures: rimFailures },
    stroke: {
      pixelThreshold: strokePixelThreshold,
      peakCoverageThreshold: strokePeakCoverageThreshold,
      darkCoverageThreshold: strokeDarkCoverageThreshold,
      minimumCoverage,
      maximumCoverage,
      minimumAngles,
      maximumAngles,
      peakFailures: strokePeakFailures,
      motionFailures: strokeMotionFailures,
    },
    bloom: { pixelThreshold: bloomPixelThreshold, maxima: bloomMaxima, failures: bloomFailures },
    palettes: { visibility: paletteVisibility, failures: paletteFailures },
  };
  fs.writeFileSync(path.join(root, '.tmp', 'composer-beam-corners.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  app.exit(
    geometryFailures.length === 0
      && rimFailures.length === 0
      && strokePeakFailures.length === 0
      && strokeMotionFailures.length === 0
      && bloomFailures.length === 0
      && paletteFailures.length === 0
      ? 0
      : 1,
  );
}).catch((error) => {
  console.error(error);
  app.exit(2);
});
