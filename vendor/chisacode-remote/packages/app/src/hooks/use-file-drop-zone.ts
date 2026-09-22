import { useState, useRef, useEffect } from "react";
import type { ImageAttachment } from "@/composer/types";
import { getDesktopHost } from "@/desktop/host";
import { persistAttachmentFromBlob, persistAttachmentFromFileUri } from "@/attachments/service";
import { isWeb } from "@/constants/platform";

interface UseFileDropZoneOptions {
  onFilesDropped: (files: ImageAttachment[]) => void;
  disabled?: boolean;
}

interface UseFileDropZoneReturn {
  isDragging: boolean;
  containerRef: React.RefObject<HTMLElement | null>;
}

const IS_WEB = isWeb;
const IMAGE_MIME_BY_EXTENSION: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".svg": "image/svg+xml",
  ".heic": "image/heic",
  ".heif": "image/heif",
  ".avif": "image/avif",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
};

function isImageFile(file: File): boolean {
  return file.type.startsWith("image/");
}

function getFileExtension(path: string): string {
  const normalizedPath = path.split("#", 1)[0]?.split("?", 1)[0] ?? path;
  const extensionIndex = normalizedPath.lastIndexOf(".");
  if (extensionIndex < 0) {
    return "";
  }
  return normalizedPath.slice(extensionIndex).toLowerCase();
}

async function filePathToImageAttachment(path: string): Promise<ImageAttachment> {
  const extension = getFileExtension(path);
  const mimeType = IMAGE_MIME_BY_EXTENSION[extension] ?? "image/jpeg";
  return await persistAttachmentFromFileUri({ uri: path, mimeType });
}

async function fileToImageAttachment(file: File): Promise<ImageAttachment> {
  // In the Electron desktop runtime, prefer the native file path via
  // webUtils.getPathForFile so the attachment store can read the file
  // directly instead of copying through an in-memory Blob.
  const desktopHost = getDesktopHost();
  const nativePath = desktopHost?.webUtils?.getPathForFile?.(file);
  if (nativePath) {
    return await filePathToImageAttachment(nativePath);
  }

  return await persistAttachmentFromBlob({
    blob: file,
    mimeType: file.type || "image/jpeg",
    fileName: file.name,
  });
}

export function useFileDropZone({
  onFilesDropped,
  disabled = false,
}: UseFileDropZoneOptions): UseFileDropZoneReturn {
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLElement | null>(null);
  const dragCounterRef = useRef(0);
  const onFilesDroppedRef = useRef(onFilesDropped);

  // Keep callback ref up to date
  useEffect(() => {
    onFilesDroppedRef.current = onFilesDropped;
  }, [onFilesDropped]);

  // Reset drag state when disabled changes
  useEffect(() => {
    if (disabled) {
      setIsDragging(false);
      dragCounterRef.current = 0;
    }
  }, [disabled]);

  // Set up DOM drag-drop event listeners on web.
  // In the Electron desktop runtime, handleDrop resolves native file paths
  // via webUtils.getPathForFile (see fileToImageAttachment), so behavior is
  // equivalent to a native drag-drop IPC without the extra surface area.
  useEffect(() => {
    if (!IS_WEB) return;

    const element = containerRef.current;
    if (!element) {
      return;
    }

    function handleDragEnter(e: DragEvent) {
      e.preventDefault();
      e.stopPropagation();

      if (disabled) return;

      dragCounterRef.current++;
      if (e.dataTransfer?.types.includes("Files")) {
        setIsDragging(true);
      }
    }

    function handleDragOver(e: DragEvent) {
      e.preventDefault();
      e.stopPropagation();

      if (disabled) return;

      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = "copy";
      }
    }

    function handleDragLeave(e: DragEvent) {
      e.preventDefault();
      e.stopPropagation();

      if (disabled) return;

      dragCounterRef.current--;
      if (dragCounterRef.current === 0) {
        setIsDragging(false);
      }
    }

    async function handleDrop(e: DragEvent) {
      e.preventDefault();
      e.stopPropagation();

      setIsDragging(false);
      dragCounterRef.current = 0;

      if (disabled) return;

      const files = Array.from(e.dataTransfer?.files ?? []);
      const imageFiles = files.filter(isImageFile);

      if (imageFiles.length === 0) return;

      try {
        const attachments = await Promise.all(imageFiles.map(fileToImageAttachment));
        onFilesDroppedRef.current(attachments);
      } catch (error) {
        console.error("[useFileDropZone] Failed to process dropped files:", error);
      }
    }

    element.addEventListener("dragenter", handleDragEnter);
    element.addEventListener("dragover", handleDragOver);
    element.addEventListener("dragleave", handleDragLeave);
    element.addEventListener("drop", handleDrop);

    return () => {
      element.removeEventListener("dragenter", handleDragEnter);
      element.removeEventListener("dragover", handleDragOver);
      element.removeEventListener("dragleave", handleDragLeave);
      element.removeEventListener("drop", handleDrop);
    };
  }, [disabled]);

  return {
    isDragging,
    containerRef,
  };
}
