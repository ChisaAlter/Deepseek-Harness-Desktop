import type { AttachmentMetadata } from "@/attachments/types";
import { encodeAttachmentsForSend } from "@/attachments/service";

type ImageInput = AttachmentMetadata;

/**
 * Encodes image attachments for sending on the wire
 * @param images Optional attachment metadata list
 * @returns Base64 data/mime pairs, or undefined when no images are provided
 */
export async function encodeImages(
  images?: ImageInput[],
): Promise<Array<{ data: string; mimeType: string }> | undefined> {
  return await encodeAttachmentsForSend(images);
}
