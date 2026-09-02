// Pre-send image guard (DEF-ATTACH-TEXTMODEL). Mirrors the desktop composer:
// a model whose declared inputModalities lack 'image' refuses attachments
// before the request leaves the phone. Unknown modalities defer to the host,
// which owns the vision-fallback decision and answers with a visible error.

const IMAGE_UNSUPPORTED_MESSAGE = '当前模型不支持图片，请切换支持图片的模型';

function attachmentGuard({ current, attachments }) {
  const hasImages = Array.isArray(attachments) && attachments.length > 0;
  if (!hasImages) return { ok: true };
  if (current && current.supportsImages === false) return { ok: false, message: IMAGE_UNSUPPORTED_MESSAGE };
  return { ok: true };
}

export { IMAGE_UNSUPPORTED_MESSAGE, attachmentGuard };
