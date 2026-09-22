import { randomUUID } from "node:crypto";
import type { Dirent } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { AgentTimelineItem } from "../../agent-sdk-types.js";
import { ensurePrivateDirectory, writePrivateFileSync } from "../../../private-files.js";
import {
  renderProviderImageOutputAsAssistantMarkdown,
  type ProviderImageOutput,
} from "../provider-image-output.js";

const CODEX_IMAGE_ATTACHMENT_DIR = "chisacode-attachments";
const STALE_ATTACHMENT_TTL_MS = 60 * 60 * 1000;

interface ImageDataPayload {
  mimeType: string;
  data: string;
}

function toObjectRecord(value: unknown): Record<string, unknown> | undefined {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function firstStringField(
  record: Record<string, unknown>,
  fields: readonly string[],
): string | null {
  for (const field of fields) {
    const value = record[field];
    if (typeof value === "string") {
      return value;
    }
  }
  return null;
}

function codexImageOutputFromResult(result: unknown): ProviderImageOutput | null {
  if (typeof result === "string") {
    const trimmed = result.trim();
    if (
      trimmed.toLowerCase().startsWith("data:image/") ||
      (/^[A-Za-z0-9+/]+={0,2}$/.test(trimmed) && trimmed.length > 64)
    ) {
      return { data: trimmed };
    }
    return { url: trimmed };
  }
  const resultRecord = toObjectRecord(result);
  if (!resultRecord) {
    return null;
  }
  return {
    path: firstStringField(resultRecord, ["path", "savedPath", "saved_path"]),
    url: firstStringField(resultRecord, ["url"]),
    data: firstStringField(resultRecord, ["data"]),
    mimeType: firstStringField(resultRecord, ["mimeType", "mime_type"]),
  };
}

function getImageExtension(mimeType: string): string {
  switch (mimeType) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    case "image/bmp":
      return "bmp";
    case "image/tiff":
      return "tiff";
    default:
      return "bin";
  }
}

function normalizeImageData(mimeType: string, data: string): ImageDataPayload {
  if (data.startsWith("data:")) {
    const match = data.match(/^data:([^;]+);base64,(.*)$/);
    if (match) {
      return { mimeType: match[1], data: match[2] };
    }
  }
  return { mimeType, data };
}

function writeImageAttachmentSync(mimeType: string, data: string): string {
  const attachmentsDir = path.join(os.tmpdir(), CODEX_IMAGE_ATTACHMENT_DIR);
  ensurePrivateDirectory(attachmentsDir);
  const normalized = normalizeImageData(mimeType, data);
  const extension = getImageExtension(normalized.mimeType);
  const filename = `${randomUUID()}.${extension}`;
  const filePath = path.join(attachmentsDir, filename);
  writePrivateFileSync(filePath, Buffer.from(normalized.data, "base64"));
  return filePath;
}

function materializeCodexImageOutput(image: { data: string; mimeType: string | null }): {
  path: string;
} {
  return {
    path: writeImageAttachmentSync(image.mimeType ?? "image/png", image.data),
  };
}

export function mapCodexThreadImageItem(
  normalizedType: string,
  normalizedItem: Record<string, unknown>,
): AgentTimelineItem | null {
  if (normalizedType === "imageView") {
    return renderProviderImageOutputAsAssistantMarkdown({
      path: firstStringField(normalizedItem, ["path"]),
    });
  }

  const savedPath = firstStringField(normalizedItem, ["savedPath", "saved_path"]);
  const result = codexImageOutputFromResult(normalizedItem.result);
  return renderProviderImageOutputAsAssistantMarkdown(
    {
      path: savedPath ?? result?.path ?? null,
      url: result?.url ?? null,
      data: result?.data ?? null,
      mimeType: result?.mimeType ?? null,
    },
    { materialize: materializeCodexImageOutput },
  );
}

export async function writeCodexImageAttachment(mimeType: string, data: string): Promise<string> {
  // private-files.ts only exposes sync helpers; each payload is one image, so
  // this wrapper keeps both call sites on the same 0o600/0o700 write path.
  return writeImageAttachmentSync(mimeType, data);
}

/**
 * Best-effort cleanup of stale Codex image attachments in os.tmpdir().
 * @internal Exported for targeted unit testing only; not part of the provider's public API.
 */
export async function cleanupStaleCodexImageAttachments(): Promise<void> {
  const attachmentsDir = path.join(os.tmpdir(), CODEX_IMAGE_ATTACHMENT_DIR);
  let entries: Dirent[];
  try {
    entries = await fs.readdir(attachmentsDir, { withFileTypes: true });
  } catch {
    return;
  }
  const now = Date.now();
  await Promise.all(
    entries.map(async (entry) => {
      if (!entry.isFile()) return;
      const filePath = path.join(attachmentsDir, entry.name);
      try {
        const stat = await fs.stat(filePath);
        if (now - stat.mtimeMs > STALE_ATTACHMENT_TTL_MS) {
          await fs.unlink(filePath);
        }
      } catch {
        // Ignore individual file failures; cleanup is opportunistic.
      }
    }),
  );
}
