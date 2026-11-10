/** Browser-held sources let an accepted request survive a free-host restart. */
const DATABASE = "dawnstudy-generation-recovery-v1";
const STORE = "requests";

type SavedField = { name: string; value: string } | { name: string; value: Blob; filename: string };
export type PendingGenerationRequest = {
  userId: string; requestId: string; jobId: string; savedAt: number;
  fields: SavedField[]; base?: Record<string, unknown>; checkpoint?: Record<string, unknown>; cancelRequested?: boolean;
};

/** Detect new verified content without repeatedly serializing large image bytes. */
export function generationCheckpointRevision(checkpoint: Record<string, unknown>): string {
  const { items, ...metadata } = checkpoint;
  return JSON.stringify({
    ...metadata,
    items: Array.isArray(items) ? items.map((value) => {
      if (!value || typeof value !== "object") return value;
      const { images, ...card } = value as Record<string, unknown>;
      return { ...card, image_count: Array.isArray(images) ? images.length : 0 };
    }) : items,
  });
}

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("Local generation recovery is unavailable."));
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "userId" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Could not open generation recovery storage."));
    request.onblocked = () => reject(new Error("Generation recovery storage is busy in another tab."));
  });
}

async function withStore<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore, resolve: (value: T) => void) => void): Promise<T> {
  const database = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(STORE, mode);
      let result: T;
      action(transaction.objectStore(STORE), (value) => { result = value; });
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = () => reject(transaction.error || new Error("Could not keep generation recovery data."));
      transaction.onabort = () => reject(transaction.error || new Error("Generation recovery storage was interrupted."));
    });
  } finally { database.close(); }
}

export function captureGenerationRequest(userId: string, form: FormData, base?: Record<string, unknown>): PendingGenerationRequest {
  const existingId = form.get("client_request_id");
  const requestId = typeof existingId === "string" && existingId ? existingId : crypto.randomUUID();
  form.set("client_request_id", requestId);
  return {
    userId, requestId, jobId: requestId, savedAt: Date.now(), base,
    fields: Array.from(form.entries(), ([name, value]) => typeof value === "string"
      ? { name, value } : { name, value, filename: value.name }),
  };
}

export function restoreGenerationForm(pending: PendingGenerationRequest): FormData {
  const form = new FormData();
  for (const field of pending.fields) {
    if (typeof field.value === "string") form.append(field.name, field.value);
    else form.append(field.name, field.value, "filename" in field ? field.filename : "material");
  }
  form.set("client_request_id", pending.requestId);
  if (pending.checkpoint) form.set("checkpoint_json", JSON.stringify(pending.checkpoint));
  return form;
}

export async function savePendingGenerationRequest(pending: PendingGenerationRequest): Promise<void> {
  await withStore<void>("readwrite", (store) => { store.put(pending); });
}

export async function getPendingGenerationRequest(userId: string): Promise<PendingGenerationRequest | null> {
  return withStore<PendingGenerationRequest | null>("readonly", (store, resolve) => {
    const request = store.get(userId);
    request.onsuccess = () => resolve(request.result || null);
  });
}

export async function updatePendingGenerationRequest(userId: string, requestId: string, updates: { jobId?: string; checkpoint?: Record<string, unknown>; cancelRequested?: boolean }): Promise<void> {
  await withStore<void>("readwrite", (store) => {
    const request = store.get(userId);
    request.onsuccess = () => {
      // An older observer must never overwrite a newer request from this account.
      if (request.result?.requestId === requestId) store.put({ ...request.result, ...updates });
    };
  });
}

export async function deletePendingGenerationRequest(userId: string, requestId?: string): Promise<void> {
  await withStore<void>("readwrite", (store) => {
    const request = store.get(userId);
    request.onsuccess = () => {
      if (request.result && (!requestId || request.result.requestId === requestId)) store.delete(userId);
    };
  });
}
