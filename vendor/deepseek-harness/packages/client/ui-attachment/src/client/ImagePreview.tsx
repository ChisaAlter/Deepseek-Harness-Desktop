import type { ImagePreviewProps } from '@deepseek-ai/dsh-client-ui-chat/client'
import { ImageLightbox } from '../ImageLightbox.tsx'
import { lightboxLabels } from './labels.ts'

/** Markdown image preview slot entry: the shared original-image lightbox driven by chat owner props. */
export function ImagePreview({ src, alt, open, onClose, t }: ImagePreviewProps) {
  return <ImageLightbox src={src} alt={alt} open={open} onClose={onClose} labels={lightboxLabels(t)} />
}
