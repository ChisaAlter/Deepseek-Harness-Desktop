import { createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';

import { t } from './i18n.mjs';

const FILES_DIRECTORY = join('.dsh-im', 'inbound');

export class InboundFileError extends Error {
  constructor(code, message, userMessage = t('文件接收失败，请重新发送后再试。'), options = {}) {
    super(message, options);
    this.name = 'InboundFileError';
    this.code = code;
    this.userMessage = userMessage;
  }
}

function fileSources(message) {
  return Array.isArray(message?.files) ? message.files.filter(Boolean) : [];
}

function displayName(value, fallback) {
  if (typeof value !== 'string') return fallback;
  const cleaned = value
    .replaceAll('\\', '/')
    .split('/')
    .at(-1)
    ?.replace(/[\u0000-\u001f\u007f]/g, '')
    .trim();
  return cleaned || fallback;
}

function storageName(value, index) {
  const cleaned = displayName(value, 'file')
    .replace(/[^\p{L}\p{N}._ -]/gu, '_')
    .replace(/^\.+/, '')
    .slice(0, 160) || 'file';
  return `${String(index + 1).padStart(2, '0')}-${cleaned}`;
}

function loadedFile(value) {
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return { data: Buffer.from(value) };
  }
  const raw = value?.data ?? value?.buffer;
  if (Buffer.isBuffer(raw) || raw instanceof Uint8Array) {
    return {
      data: Buffer.from(raw),
      name: value?.name ?? value?.filename,
      mediaType: value?.mediaType ?? value?.mimetype,
    };
  }
  const stream = value?.stream ?? value;
  if (stream && typeof stream[Symbol.asyncIterator] === 'function') {
    return {
      stream,
      name: value?.name ?? value?.filename,
      mediaType: value?.mediaType ?? value?.mimetype,
    };
  }
  return null;
}

export function hasInboundFiles(message) {
  return fileSources(message).length > 0;
}

/** Start provider downloads immediately while preserving the lazy file-source contract. */
export function prefetchInboundFiles(message, { signal } = {}) {
  const sources = fileSources(message);
  if (sources.length === 0) return message;
  return {
    ...message,
    files: sources.map((source) => {
      if (source?.data !== undefined || typeof source?.load !== 'function') return source;
      let download;
      try {
        download = Promise.resolve(source.load({ signal }));
      } catch (error) {
        download = Promise.reject(error);
      }
      download.catch(() => undefined);
      return {
        ...source,
        async load({ signal: loadSignal } = {}) {
          loadSignal?.throwIfAborted();
          const result = await download;
          loadSignal?.throwIfAborted();
          return result;
        },
      };
    }),
  };
}

export async function stageInboundFiles(message, {
  workspace,
  signal,
} = {}) {
  const sources = fileSources(message);
  if (sources.length === 0) return null;
  if (typeof workspace !== 'string' || !isAbsolute(workspace)) {
    throw new InboundFileError(
      'inbound-file-workspace-unavailable',
      'The Harness Session workspace is unavailable for inbound files.',
    );
  }

  signal?.throwIfAborted();
  const root = resolve(workspace, FILES_DIRECTORY);
  await mkdir(root, { recursive: true, mode: 0o700 });
  const directory = await mkdtemp(join(root, 'turn-'));
  const files = [];

  try {
    for (const [index, source] of sources.entries()) {
      signal?.throwIfAborted();
      let value;
      try {
        value = source?.data === undefined
          ? await source?.load?.({ signal })
          : source.data;
      } catch (error) {
        if (signal?.aborted) throw error;
        throw new InboundFileError(
          'inbound-file-download-failed',
          `Unable to download inbound file ${index + 1}: ${error?.message ?? String(error)}`,
          t('文件下载失败，请重新发送后再试。'),
          { cause: error },
        );
      }

      const loaded = loadedFile(value);
      if (!loaded) {
        throw new InboundFileError(
          'inbound-file-data-invalid',
          `Inbound file ${index + 1} returned no readable data.`,
        );
      }
      const name = displayName(loaded.name ?? source?.name, `file-${index + 1}`);
      const path = join(directory, storageName(name, index));
      if (loaded.data) {
        await writeFile(path, loaded.data, { mode: 0o600, signal });
      } else {
        try {
          await pipeline(
            loaded.stream,
            createWriteStream(path, { flags: 'wx', mode: 0o600 }),
            { signal },
          );
        } catch (error) {
          if (signal?.aborted) throw error;
          throw new InboundFileError(
            'inbound-file-download-failed',
            `Unable to stream inbound file ${index + 1}: ${error?.message ?? String(error)}`,
            t('文件下载失败，请重新发送后再试。'),
            { cause: error },
          );
        }
      }
      const relativePath = relative(resolve(workspace), path);
      if (!relativePath || relativePath.startsWith('..') || isAbsolute(relativePath)) {
        throw new InboundFileError(
          'inbound-file-path-invalid',
          'The staged inbound file escaped the Harness Session workspace.',
        );
      }
      files.push(Object.freeze({
        name,
        path: relativePath,
        ...(typeof (loaded.mediaType ?? source?.mediaType) === 'string'
          && (loaded.mediaType ?? source.mediaType).trim()
          ? { mediaType: (loaded.mediaType ?? source.mediaType).trim() }
          : {}),
      }));
    }
    return Object.freeze({
      files: Object.freeze(files),
      async cleanup() {
        await rm(directory, { recursive: true, force: true });
      },
    });
  } catch (error) {
    await rm(directory, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

export function appendInboundFilesToPrompt(prompt, staged) {
  if (!staged?.files?.length) return prompt;
  const manifest = [
    '<dsh_im_files>',
    JSON.stringify({
      description: 'Files uploaded with this user message. Paths are relative to the current Harness workspace.',
      files: staged.files,
    }),
    '</dsh_im_files>',
  ].join('\n');

  if (Array.isArray(prompt)) return [...prompt, { type: 'text', text: manifest }];
  const text = typeof prompt === 'string' ? prompt.trim() : '';
  return text ? `${text}\n\n${manifest}` : manifest;
}

export function inboundFileUserMessage(error) {
  return error instanceof InboundFileError ? error.userMessage : null;
}
