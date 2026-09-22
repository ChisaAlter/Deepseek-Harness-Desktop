import type { AttachmentMetadata } from "@/attachments/types";
import { persistAttachmentFromBlob } from "@/attachments/service";

/** The structural subset of a clipboard item needed to extract an image file */
export interface ClipboardItemLike {
  kind?: string;
  type?: string;
  getAsFile?: () => File | null;
}

/** The structural subset of clipboard event data needed to enumerate items */
export interface ClipboardDataLike {
  items?: ArrayLike<ClipboardItemLike> | null;
}

/** A persisted attachment produced from a clipboard or dropped image file */
export type ImageAttachmentFromFile = AttachmentMetadata;

/**
 * Extracts image files from clipboard event data, ignoring non-file and non-image items
 * @param clipboardData The clipboard data to inspect, if any
 * @returns The image files found in the clipboard items
 */
export function collectImageFilesFromClipboardData(
  clipboardData?: ClipboardDataLike | null,
): File[] {
  if (!clipboardData?.items) {
    return [];
  }

  const files: File[] = [];
  for (const item of Array.from(clipboardData.items)) {
    if (item?.kind !== "file") {
      continue;
    }
    if (!item.type?.startsWith("image/")) {
      continue;
    }
    const file = item.getAsFile?.();
    if (!file) {
      continue;
    }
    files.push(file);
  }

  return files;
}

/**
 * Persists image files as attachments, skipping files that fail to persist
 * @param files The image files to persist
 * @returns The attachments that were persisted successfully
 */
export async function filesToImageAttachments(
  files: readonly File[],
): Promise<ImageAttachmentFromFile[]> {
  const attachments = await Promise.all(
    files.map(async (file) => {
      try {
        return await persistAttachmentFromBlob({
          blob: file,
          mimeType: file.type || "image/jpeg",
          fileName: file.name,
        });
      } catch (error) {
        console.error("[attachments] Failed to persist file attachment", {
          fileName: file.name,
          error,
        });
        return null;
      }
    }),
  );

  return attachments.filter((entry): entry is ImageAttachmentFromFile => entry !== null);
}
