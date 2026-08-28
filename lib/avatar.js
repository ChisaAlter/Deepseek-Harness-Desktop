/**
 * Catalog avatar records: hashed blob characters or a small baked image.
 * The web client duplicates these helpers; keep both copies in lockstep.
 */

export const BLOB_SHAPES = Object.freeze([
  'circle', 'soft', 'square', 'pill', 'triangle', 'hex', 'cloud', 'drop',
]);

export const BLOB_COLORS = Object.freeze([
  'ink', 'brown', 'red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink', 'grey',
]);

export const BLOB_SHAPE_RADII = Object.freeze({
  circle: [22, 22, 22, 22, 22, 22, 22, 22],
  soft: [20, 25, 21, 24, 19, 23, 22, 26],
  square: [18, 26, 18, 26, 18, 26, 18, 26],
  pill: [14, 18, 26, 18, 14, 18, 26, 18],
  triangle: [26, 16, 12, 22, 13, 22, 12, 16],
  hex: [20, 24, 24, 20, 24, 24, 20, 24],
  cloud: [14, 26, 22, 18, 16, 18, 22, 26],
  drop: [12, 16, 20, 24, 26, 24, 20, 16],
});

export const IMAGE_AVATAR_MAX_CHARS = 120_000;

const IMAGE_DATA_URL = /^data:image\/(jpeg|jpg|png);base64,/i;
const HANDLE_K = (4 / 3) * Math.tan(Math.PI / 16);

/**
 * @param {string | undefined} seed
 * @returns {number}
 */
export function avatarSeedHash(seed) {
  const text = String(seed ?? '');
  let hash = 0;
  for (const char of text) {
    hash = (hash * 31 + char.codePointAt(0)) >>> 0;
  }
  return hash;
}

/**
 * @param {string | undefined} seed
 * @returns {{ kind: 'blob', shape: string, color: string }}
 */
export function defaultBlobAvatar(seed) {
  const hash = avatarSeedHash(seed);
  return {
    kind: 'blob',
    shape: BLOB_SHAPES[hash % BLOB_SHAPES.length],
    color: BLOB_COLORS[Math.floor(hash / BLOB_SHAPES.length) % BLOB_COLORS.length],
  };
}

/**
 * @param {string} dataUrl
 * @param {string} crop
 * @returns {{ kind: 'image', dataUrl: string, crop: 'circle' | 'square' }}
 */
export function assertImageAvatar(dataUrl, crop) {
  const url = String(dataUrl ?? '');
  const nextCrop = crop === 'square' ? 'square' : crop === 'circle' ? 'circle' : '';
  if (nextCrop !== 'circle' && nextCrop !== 'square') {
    throw new Error('avatar crop must be circle or square');
  }
  if (!IMAGE_DATA_URL.test(url)) {
    throw new Error('avatar image must be a jpeg or png data URL');
  }
  if (url.length > IMAGE_AVATAR_MAX_CHARS) {
    throw new Error('avatar image is too large');
  }
  return { kind: 'image', dataUrl: url, crop: nextCrop };
}

/**
 * @param {object | undefined} raw
 * @param {string | undefined} seed
 * @returns {object}
 */
export function normalizeAvatar(raw, seed) {
  if (raw && raw.kind === 'image') {
    try {
      return assertImageAvatar(raw.dataUrl, raw.crop);
    } catch {
      return defaultBlobAvatar(seed);
    }
  }
  if (
    raw
    && raw.kind === 'blob'
    && BLOB_SHAPES.includes(raw.shape)
    && BLOB_COLORS.includes(raw.color)
  ) {
    return { kind: 'blob', shape: raw.shape, color: raw.color };
  }
  return defaultBlobAvatar(seed);
}

/**
 * Closed cubic path for a blob shape.
 * squash 0 is rest, 1 is a squat bulge, -1 is a tall tuck; lean shears the top.
 * @param {string} shape
 * @param {number} squash
 * @param {number} [lean]
 * @returns {string}
 */
export function blobPath(shape, squash, lean) {
  const radii = BLOB_SHAPE_RADII[shape] || BLOB_SHAPE_RADII.circle;
  const amount = Number(squash) || 0;
  const shear = Number(lean) || 0;
  const squat = Math.max(0, amount);
  const stretch = Math.max(0, -amount);
  const n = 8;
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    const nx = Math.cos(a);
    const ny = Math.sin(a);
    const r = radii[i] * (
      1
      - squat * 0.42 * (ny * ny)
      + squat * 0.36 * (nx * nx)
      + stretch * 0.12 * (ny * ny)
      - stretch * 0.22 * (nx * nx)
    );
    pts.push({
      x: 32 + r * nx + shear * 7 * (0.35 - ny),
      y: 32 + r * ny + squat * 7 - stretch * 2,
      a,
      r,
    });
  }
  const cmds = [];
  for (let i = 0; i < n; i++) {
    const p0 = pts[i];
    const p1 = pts[(i + 1) % n];
    const h0 = p0.r * HANDLE_K;
    const h1 = p1.r * HANDLE_K;
    const a0 = p0.a + Math.PI / 2;
    const a1 = p1.a + Math.PI / 2;
    if (i === 0) cmds.push(`M ${p0.x.toFixed(2)} ${p0.y.toFixed(2)}`);
    cmds.push(
      `C ${(p0.x + Math.cos(a0) * h0).toFixed(2)} ${(p0.y + Math.sin(a0) * h0).toFixed(2)} `
      + `${(p1.x - Math.cos(a1) * h1).toFixed(2)} ${(p1.y - Math.sin(a1) * h1).toFixed(2)} `
      + `${p1.x.toFixed(2)} ${p1.y.toFixed(2)}`,
    );
  }
  cmds.push('Z');
  return cmds.join(' ');
}
