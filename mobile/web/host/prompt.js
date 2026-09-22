// 镜像 mobile/android :protocol host/Prompt.kt（text/image block 与 mode:'queue' payload）。

const ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

function textBlock(text) {
  return { type: 'text', text };
}

function base64FromBytes(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function imageBlock(mediaType, bytes) {
  if (!ALLOWED_IMAGE_TYPES.includes(mediaType)) {
    throw new Error('unsupported image type');
  }
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return { type: 'image', mediaType, data: base64FromBytes(view) };
}

function promptPayload(blocks) {
  return { mode: 'queue', content: blocks };
}

export { ALLOWED_IMAGE_TYPES, textBlock, imageBlock, promptPayload };
