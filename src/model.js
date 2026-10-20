// Where the checkpoint and its voices are: one model record plus a global voice library, both
// imported through the options page and stored in IndexedDB (see store.js). There is no bundled
// model, so until one is imported there is nothing to speak with.
//
// The runtime only takes URLs, so `buildSpec` turns the stored blobs into `blob:` URLs. That
// has to happen in the background page: a blob URL dies with the document that created it.

function voiceNames(record) {
  return Object.keys(record.voices ?? {});
}

/** The languages from the checkpoint's config, when its blob is readable. */
async function readLanguages(record) {
  const blob = record.files?.["config.json"];
  if (!blob || typeof blob.text !== "function") return [];
  try {
    const config = JSON.parse(await blob.text());
    return Array.isArray(config.languages) ? config.languages.filter((language) => typeof language === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Describe the imported checkpoint and the voices that can speak with it. The model's own
 * voices win over a library voice with the same name (every checkpoint has `default`).
 * No URLs are made here; this is cheap enough for the options page to call on every visit.
 *
 * @param {object} options
 * @param {object} options.settings
 * @param {{ getModel: (name: string) => Promise<object | null>, allVoices?: () => Promise<object[]> }} options.store
 */
export async function describeModel({ settings, store }) {
  if (!settings.modelName) {
    const library = store
      ? ((await store.allVoices?.()) ?? []).filter((voice) => voice?.name && voice.blob)
      : [];
    return {
      source: "none",
      modelDir: "",
      voices: [],
      modelVoices: [],
      library,
      languages: [],
      defaultVoice: null
    };
  }
  if (!store) throw new Error("imported models are not available in this browser");

  const record = await store.getModel(settings.modelName);
  if (!record) {
    throw new Error(
      `the imported model '${settings.modelName}' is no longer in browser storage; import it again`
    );
  }

  const modelVoices = voiceNames(record);
  if (modelVoices.length === 0) throw new Error(`the imported model '${record.name}' has no voice file`);

  const library = ((await store.allVoices?.()) ?? []).filter((voice) => voice?.name && voice.blob);
  const merged = [...modelVoices];
  for (const voice of library) {
    if (!merged.includes(voice.name)) merged.push(voice.name);
  }

  const defaultVoice = merged.includes(settings.voice)
    ? settings.voice
    : record.voices[record.defaultVoice]
      ? record.defaultVoice
      : merged[0];

  return {
    source: "imported",
    modelDir: record.name,
    voices: merged,
    modelVoices,
    library,
    languages: await readLanguages(record),
    defaultVoice,
    record
  };
}

/**
 * Turn a described model into a runtime `ModelSpec` and the blob URLs it owns. Revoke the URLs
 * with `URL.revokeObjectURL` when the model is disposed.
 *
 * @returns {{ spec: object, blobUrls: string[] }}
 */
export function buildSpec(model) {
  if (model.source !== "imported") {
    throw new Error("No model imported yet. Open the extension settings and import a model folder.");
  }

  const record = model.record;
  const blobUrls = [];
  const url = (path) => {
    const blob = record.files?.[path];
    if (!blob) throw new Error(`the imported model is missing ${path}; import it again`);
    const value = URL.createObjectURL(blob);
    blobUrls.push(value);
    return value;
  };

  // Model voices first; a library voice with the same name is shadowed.
  const voices = {};
  for (const [name, path] of Object.entries(record.voices)) voices[name] = url(path);
  for (const voice of model.library ?? []) {
    if (voices[voice.name]) continue;
    const value = URL.createObjectURL(voice.blob);
    blobUrls.push(value);
    voices[voice.name] = value;
  }

  return {
    blobUrls,
    spec: {
      weights: { q8: url(record.weights) },
      tokenizer: url("tokenizer.json"),
      config: url("config.json"),
      voices,
      defaultVoice: model.defaultVoice
    }
  };
}
