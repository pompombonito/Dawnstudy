const DATABASE_NAME = "dawnstudy-local-recovery";
const STORE_NAME = "study-set-drafts";
const DATABASE_VERSION = 1;

export type UnsyncedStudyDraft = {
  userId: string;
  savedAt: number;
  studySet: Record<string, unknown>;
};

function openDraftDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("Local recovery storage is unavailable."));
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) database.createObjectStore(STORE_NAME, { keyPath: "userId" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Could not open local recovery storage."));
    request.onblocked = () => reject(new Error("Local recovery storage is busy in another tab."));
  });
}

async function withDraftStore<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const database = await openDraftDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, mode);
      const request = action(transaction.objectStore(STORE_NAME));
      let result: T;
      request.onsuccess = () => { result = request.result; };
      request.onerror = () => reject(request.error || new Error("Local recovery storage failed."));
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = () => reject(transaction.error || new Error("Local recovery storage failed."));
      transaction.onabort = () => reject(transaction.error || new Error("Local recovery storage was interrupted."));
    });
  } finally {
    database.close();
  }
}

export async function saveUnsyncedStudyDraft(userId: string, studySet: Record<string, unknown>) {
  const draft: UnsyncedStudyDraft = { userId, savedAt: Date.now(), studySet };
  await withDraftStore("readwrite", (store) => store.put(draft));
}

export async function getUnsyncedStudyDraft(userId: string): Promise<UnsyncedStudyDraft | null> {
  return (await withDraftStore("readonly", (store) => store.get(userId))) || null;
}

export async function deleteUnsyncedStudyDraft(userId: string) {
  await withDraftStore("readwrite", (store) => store.delete(userId));
}
