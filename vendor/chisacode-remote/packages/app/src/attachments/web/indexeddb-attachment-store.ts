import {
  type AttachmentStore,
  type AttachmentMetadata,
  type SaveAttachmentInput,
} from "@/attachments/types";
import {
  blobToBase64,
  generateAttachmentId,
  normalizeMimeType,
  parseDataUrl,
} from "@/attachments/utils";

interface StoredBlobRecord {
  id: string;
  blob: Blob;
  createdAt: number;
  fileName: string | null;
}

const DB_NAME = "chisacode-attachment-bytes";
const LEGACY_DB_NAME = "chisacode-attachment-bytes";
const STORE_NAME = "attachments";
const DB_VERSION = 1;

function ensureIndexedDb(): IDBFactory {
  const idb = globalThis.indexedDB;
  if (!idb) {
    throw new Error("当前运行环境不支持 IndexedDB。");
  }
  return idb;
}

function openAttachmentDb(dbName = DB_NAME): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = ensureIndexedDb().open(dbName, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };

    request.addEventListener("success", () => {
      resolve(request.result);
    });

    request.addEventListener("error", () => {
      reject(request.error ?? new Error("无法打开附件 IndexedDB。"));
    });
  });
}

function runTx<T>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, mode);
    const store = transaction.objectStore(STORE_NAME);
    const request = run(store);

    request.addEventListener("success", () => {
      resolve(request.result);
    });

    request.addEventListener("error", () => {
      reject(request.error ?? new Error("IndexedDB 事务请求失败。"));
    });

    transaction.addEventListener("error", () => {
      reject(transaction.error ?? new Error("IndexedDB 事务失败。"));
    });
  });
}

async function sourceToBlob(input: SaveAttachmentInput): Promise<{ blob: Blob; mimeType: string }> {
  const source = input.source;
  if (source.kind === "bytes") {
    const mimeType = normalizeMimeType(input.mimeType);
    const buffer = new ArrayBuffer(source.bytes.byteLength);
    new Uint8Array(buffer).set(source.bytes);
    return {
      blob: new Blob([buffer], { type: mimeType }),
      mimeType,
    };
  }

  if (source.kind === "blob") {
    const mimeType = normalizeMimeType(input.mimeType ?? source.blob.type);
    const blob =
      source.blob.type === mimeType
        ? source.blob
        : source.blob.slice(0, source.blob.size, mimeType);
    return { blob, mimeType };
  }

  if (source.kind === "data_url") {
    const parsed = parseDataUrl(source.dataUrl);
    const response = await fetch(source.dataUrl);
    const blob = await response.blob();
    const mimeType = normalizeMimeType(input.mimeType ?? parsed.mimeType ?? blob.type);
    return {
      blob: blob.type === mimeType ? blob : blob.slice(0, blob.size, mimeType),
      mimeType,
    };
  }

  const response = await fetch(source.uri);
  const blob = await response.blob();
  const mimeType = normalizeMimeType(input.mimeType ?? blob.type);
  return {
    blob: blob.type === mimeType ? blob : blob.slice(0, blob.size, mimeType),
    mimeType,
  };
}

async function loadBlob(db: IDBDatabase, id: string): Promise<Blob> {
  const record = await runTx<StoredBlobRecord | undefined>(db, "readonly", (store) =>
    store.get(id),
  );
  if (!record?.blob) {
    throw new Error(`IndexedDB 中找不到附件 ${id}。`);
  }
  return record.blob;
}

async function loadBlobFromAnyDb(id: string): Promise<Blob> {
  const db = await openAttachmentDb();
  try {
    return await loadBlob(db, id);
  } catch (error) {
    const legacyDb = await openAttachmentDb(LEGACY_DB_NAME);
    try {
      return await loadBlob(legacyDb, id);
    } catch {
      throw error;
    } finally {
      legacyDb.close();
    }
  } finally {
    db.close();
  }
}

export function createIndexedDbAttachmentStore(): AttachmentStore {
  return {
    storageType: "web-indexeddb",

    async save(input): Promise<AttachmentMetadata> {
      const id = input.id ?? generateAttachmentId();
      const createdAt = Date.now();
      const { blob, mimeType } = await sourceToBlob(input);
      const fileName = input.fileName ?? null;
      const db = await openAttachmentDb();

      try {
        await runTx(db, "readwrite", (store) =>
          store.put({ id, blob, createdAt, fileName } satisfies StoredBlobRecord),
        );
      } finally {
        db.close();
      }

      return {
        id,
        mimeType,
        storageType: "web-indexeddb",
        storageKey: id,
        fileName,
        byteSize: blob.size,
        createdAt,
      };
    },

    async encodeBase64({ attachment }): Promise<string> {
      const blob = await loadBlobFromAnyDb(attachment.storageKey);
      return await blobToBase64(blob);
    },

    async resolvePreviewUrl({ attachment }): Promise<string> {
      const blob = await loadBlobFromAnyDb(attachment.storageKey);
      return URL.createObjectURL(blob);
    },

    async releasePreviewUrl({ url }): Promise<void> {
      URL.revokeObjectURL(url);
    },

    async delete({ attachment }): Promise<void> {
      const db = await openAttachmentDb();
      try {
        await runTx(db, "readwrite", (store) => store.delete(attachment.storageKey));
      } finally {
        db.close();
      }
    },

    async garbageCollect({ referencedIds }): Promise<void> {
      const db = await openAttachmentDb();
      try {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(STORE_NAME, "readwrite");
          const store = tx.objectStore(STORE_NAME);
          const cursorRequest = store.openCursor();

          cursorRequest.addEventListener("error", () => {
            reject(cursorRequest.error ?? new Error("遍历 IndexedDB 附件存储失败。"));
          });

          cursorRequest.addEventListener("success", () => {
            const cursor = cursorRequest.result;
            if (!cursor) {
              resolve();
              return;
            }

            const key = String(cursor.key);
            if (!referencedIds.has(key)) {
              cursor.delete();
            }
            cursor.continue();
          });

          tx.addEventListener("error", () => {
            reject(tx.error ?? new Error("清理 IndexedDB 附件失败。"));
          });
        });
      } finally {
        db.close();
      }
    },
  };
}
