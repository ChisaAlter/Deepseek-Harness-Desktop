'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  PREVIEW_PIP_FRAME_CHANNEL,
  PICTURE_IN_PICTURE_INITIAL_WIDTH,
  PICTURE_IN_PICTURE_INITIAL_HEIGHT,
  PICTURE_IN_PICTURE_MIN_WIDTH,
  PICTURE_IN_PICTURE_MIN_HEIGHT,
  PICTURE_IN_PICTURE_ASPECT_RATIO_EPSILON,
  PREVIEW_PIP_FRAME_INTERVAL_MS,
  PREVIEW_PIP_JPEG_QUALITY,
  fitPictureInPictureContentSize,
  buildPreviewPictureInPictureDataUrl,
} = require('./preview-pip-protocol.js');

test('pip protocol exports the dshd frame channel and size constants', () => {
  assert.equal(PREVIEW_PIP_FRAME_CHANNEL, 'dshd-preview-pip-frame');
  assert.equal(PREVIEW_PIP_FRAME_CHANNEL.includes(['t', '3'].join('')), false);
  assert.match(PREVIEW_PIP_FRAME_CHANNEL, /^dshd-preview-/);
  assert.equal(PICTURE_IN_PICTURE_INITIAL_WIDTH, 480);
  assert.equal(PICTURE_IN_PICTURE_INITIAL_HEIGHT, 320);
  assert.equal(PICTURE_IN_PICTURE_MIN_WIDTH, 240);
  assert.equal(PICTURE_IN_PICTURE_MIN_HEIGHT, 160);
  assert.equal(PICTURE_IN_PICTURE_ASPECT_RATIO_EPSILON, 0.002);
  assert.equal(PREVIEW_PIP_FRAME_INTERVAL_MS, Math.ceil(1000 / 12));
  assert.equal(PREVIEW_PIP_JPEG_QUALITY, 80);
});

test('fitPictureInPictureContentSize preserves area across 16/9 and 9/16', () => {
  assert.deepEqual(fitPictureInPictureContentSize([480, 320], 16 / 9), [523, 294]);
  assert.deepEqual(fitPictureInPictureContentSize([480, 320], 9 / 16), [294, 523]);
});

test('fitPictureInPictureContentSize does not collapse when orientation flips twice', () => {
  const portrait = fitPictureInPictureContentSize([523, 294], 9 / 16);
  const landscape = fitPictureInPictureContentSize(portrait, 16 / 9);
  assert.deepEqual(portrait, [294, 523]);
  assert.deepEqual(landscape, [523, 294]);
});

test('pip data URL HTML is isolated JPEG chrome with CSP and #111', () => {
  const url = buildPreviewPictureInPictureDataUrl();
  assert.match(url, /^data:text\/html;charset=utf-8,/);
  const html = decodeURIComponent(url.slice('data:text/html;charset=utf-8,'.length));
  assert.match(html, /default-src 'none'/);
  assert.match(html, /img-src data:/);
  assert.match(html, /style-src 'unsafe-inline'/);
  assert.match(html, /script-src 'unsafe-inline'/);
  assert.match(html, /id="preview-frame"/);
  assert.match(html, /window\.previewPictureInPicture\.onFrame/);
  assert.match(html, /background: #111/);
  const leftoverBrand = ['t', '3', 'code'].join('');
  const leftoverTools = ['t', '3', 'tools'].join('');
  const leftoverHyphen = ['T', '3', '-'].join('');
  assert.doesNotMatch(html, new RegExp([leftoverBrand, leftoverTools, leftoverHyphen].join('|'), 'i'));
});
