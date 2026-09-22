'use strict';

const PREVIEW_PIP_FRAME_CHANNEL = 'dshd-preview-pip-frame';
const PICTURE_IN_PICTURE_INITIAL_WIDTH = 480;
const PICTURE_IN_PICTURE_INITIAL_HEIGHT = 320;
const PICTURE_IN_PICTURE_MIN_WIDTH = 240;
const PICTURE_IN_PICTURE_MIN_HEIGHT = 160;
const PICTURE_IN_PICTURE_ASPECT_RATIO_EPSILON = 0.002;
const PREVIEW_PIP_FRAME_INTERVAL_MS = Math.ceil(1000 / 12);
const PREVIEW_PIP_JPEG_QUALITY = 80;

/**
 * Isolated PiP document. Not slot-tree chrome; `#111` is the reference data-URL peel.
 * @returns {string}
 */
function buildPreviewPictureInPictureDataUrl() {
  const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'"
    >
    <meta name="color-scheme" content="dark">
    <style>
      html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; background: #111; }
      body { display: grid; place-items: center; }
      img { width: 100%; height: 100%; object-fit: contain; user-select: none; -webkit-user-drag: none; }
    </style>
  </head>
  <body>
    <img id="preview-frame" alt="Live browser preview">
    <script>
      const frame = document.getElementById("preview-frame");
      window.previewPictureInPicture.onFrame((next) => {
        frame.src = "data:image/jpeg;base64," + next.data;
      });
    </script>
  </body>
</html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

/**
 * Keep PiP content area across aspect-ratio changes (`fitPictureInPictureContentSize`).
 * @param {ReadonlyArray<number>} current
 * @param {number} aspectRatio
 * @returns {readonly [number, number]}
 */
function fitPictureInPictureContentSize(current, aspectRatio) {
  const currentWidth = Math.max(1, current[0] ?? PICTURE_IN_PICTURE_INITIAL_WIDTH);
  const currentHeight = Math.max(1, current[1] ?? PICTURE_IN_PICTURE_INITIAL_HEIGHT);
  const currentArea = currentWidth * currentHeight;
  let width = Math.sqrt(currentArea * aspectRatio);
  let height = width / aspectRatio;
  const minimumScale = Math.max(
    1,
    PICTURE_IN_PICTURE_MIN_WIDTH / width,
    PICTURE_IN_PICTURE_MIN_HEIGHT / height,
  );
  width *= minimumScale;
  height *= minimumScale;
  return [Math.round(width), Math.round(height)];
}

module.exports = {
  PREVIEW_PIP_FRAME_CHANNEL,
  PICTURE_IN_PICTURE_INITIAL_WIDTH,
  PICTURE_IN_PICTURE_INITIAL_HEIGHT,
  PICTURE_IN_PICTURE_MIN_WIDTH,
  PICTURE_IN_PICTURE_MIN_HEIGHT,
  PICTURE_IN_PICTURE_ASPECT_RATIO_EPSILON,
  PREVIEW_PIP_FRAME_INTERVAL_MS,
  PREVIEW_PIP_JPEG_QUALITY,
  buildPreviewPictureInPictureDataUrl,
  fitPictureInPictureContentSize,
};
