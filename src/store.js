// Imported checkpoints and voices, kept in the extension's IndexedDB. Blobs go in as they are,
// so a 75 MB model and a 26 MB voice catalog are copied once and available offline from then
// on; the extension folder stays small and can be updated without touching them.
//
// The model itself is read by the background page, which makes blob: URLs for the runtime
// (the runtime only takes URLs). Blob URLs are scoped to the page that made them, so the
// options page must never hand them to the background and go away.

const DB_NAME = "phonon-models";
const DB_VERSION = 2;
const MODELS = "models";
const VOICES = "voices";

function openDb() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(new Error("this browser does not offer extension storage"));
      return;
    }
    const request = globalThis.indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      // Existing installs are at version 1 (models only); adding the store keeps them.
      if (!db.objectStoreNames.contains(MODELS)) db.createObjectStore(MODELS, { keyPath: "name" });
      if (!db.objectStoreNames.contains(VOICES)) db.createObjectStore(VOICES, { keyPath: "name" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("could not open model storage"));
  });
}

function getAll(storeName) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        let request;
        try {
          request = db.transaction(storeName, "readonly").objectStore(storeName).getAll();
        } catch (error) {
          db.close();
          reject(error);
          return;
        }
        request.onsuccess = () => {
          db.close();
          resolve(request.result ?? []);
        };
        request.onerror = () => {
          db.close();
          reject(request.error);
        };
      })
  );
}

function write(storeName, action) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        let tx;
        try {
          tx = db.transaction(storeName, "readwrite");
          action(tx.objectStore(storeName));
        } catch (error) {
          db.close();
          reject(error);
          return;
        }
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error);
        };
        tx.onabort = () => {
          db.close();
          reject(tx.error ?? new Error("the storage transaction was aborted"));
        };
      })
  );
}

function metadata(voice) {
  return {
    name: voice.name,
    bytes: voice.bytes ?? voice.blob?.size ?? 0,
    language: voice.language,
    description: voice.description,
    voiceId: voice.voiceId,
    addedAt: voice.addedAt ?? 0
  };
}

/** Every imported model, without its file blobs. */
export async function listModels() {
  const records = await getAll(MODELS);
  return records
    .map((record) => ({
      name: record.name,
      bytes: record.bytes ?? 0,
      importedAt: record.importedAt ?? 0,
      voices: Object.keys(record.voices ?? {}),
      defaultVoice: record.defaultVoice
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** One imported model, with `files: { path: Blob }` and `voices: { name: path }`. */
export async function getModel(name) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction(MODELS, "readonly").objectStore(MODELS).get(name);
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

/** Store a record from `collectModelFiles`, replacing one with the same name. */
export async function putModel(record) {
  try {
    await write(MODELS, (objectStore) => objectStore.put({ ...record, importedAt: Date.now() }));
  } catch (error) {
    throw new Error(
      `could not store ${record.name} (${(record.bytes / 1024 / 1024).toFixed(0)} MB): ` +
        `${error?.message ?? error}. Is there enough disk space?`
    );
  }
}

export async function deleteModel(name) {
  await write(MODELS, (objectStore) => objectStore.delete(name));
}

/** The voice library's metadata, for the settings page. */
export async function listVoices() {
  const records = await getAll(VOICES);
  return records.map(metadata).sort((a, b) => a.name.localeCompare(b.name));
}

/** The voice library with blobs, for building the model spec. Blobs are references, not reads. */
export async function allVoices() {
  return getAll(VOICES);
}

/** Add or replace voices from `collectVoiceFiles`. */
export async function putVoices(voices) {
  try {
    await write(VOICES, (objectStore) => {
      for (const voice of voices) objectStore.put({ ...metadata(voice), blob: voice.blob, addedAt: Date.now() });
    });
  } catch (error) {
    throw new Error(`could not store the voices: ${error?.message ?? error}. Is there enough disk space?`);
  }
}

export async function deleteVoice(name) {
  await write(VOICES, (objectStore) => objectStore.delete(name));
}

/**
 * Indirection so the tests can replace storage without IndexedDB. The background uses this
 * object rather than the functions, so swapping a method affects it too.
 */
export const store = {
  listModels,
  getModel,
  putModel,
  deleteModel,
  listVoices,
  allVoices,
  putVoices,
  deleteVoice
};
