// Imported checkpoints, kept in the extension's IndexedDB. Blobs go in as they are, so a
// 75 MB model is copied once and is available offline from then on; the extension folder
// stays small and can be updated without touching it.
//
// The model itself is read by the background page, which makes blob: URLs for the runtime
// (the runtime only takes URLs). Blob URLs are scoped to the page that made them, so the
// options page must never hand them to the background and go away.

const DB_NAME = "phonon-models";
const DB_VERSION = 1;
const STORE = "models";

function openDb() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(new Error("this browser does not offer extension storage"));
      return;
    }
    const request = globalThis.indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "name" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("could not open model storage"));
  });
}

function finish(tx, db) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("the storage transaction was aborted"));
  }).finally(() => db.close());
}

/** Every imported model, without its file blobs. */
export async function listModels() {
  const db = await openDb();
  try {
    const records = await new Promise((resolve, reject) => {
      const request = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
      request.onsuccess = () => resolve(request.result ?? []);
      request.onerror = () => reject(request.error);
    });
    return records
      .map((record) => ({
        name: record.name,
        bytes: record.bytes ?? 0,
        importedAt: record.importedAt ?? 0,
        voices: Object.keys(record.voices ?? {}),
        defaultVoice: record.defaultVoice
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } finally {
    db.close();
  }
}

/** One imported model, with `files: { path: Blob }` and `voices: { name: path }`. */
export async function getModel(name) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction(STORE, "readonly").objectStore(STORE).get(name);
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

/** Store a record from `collectModelFiles`, replacing one with the same name. */
export async function putModel(record) {
  const db = await openDb();
  const tx = db.transaction(STORE, "readwrite");
  tx.objectStore(STORE).put({ ...record, importedAt: Date.now() });
  try {
    await finish(tx, db);
  } catch (error) {
    throw new Error(
      `could not store ${record.name} (${(record.bytes / 1024 / 1024).toFixed(0)} MB): ` +
        `${error?.message ?? error}. Is there enough disk space?`
    );
  }
}

export async function deleteModel(name) {
  const db = await openDb();
  const tx = db.transaction(STORE, "readwrite");
  tx.objectStore(STORE).delete(name);
  await finish(tx, db);
}

/**
 * Indirection so the tests can replace storage without IndexedDB. The background uses this
 * object rather than the functions, so swapping a method affects it too.
 */
export const store = { listModels, getModel, putModel, deleteModel };
