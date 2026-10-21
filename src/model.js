// Where the checkpoint and its voices are: the bundled Phonon 31M checkpoint that ships in the
// extension package, or one imported through the options page and stored in IndexedDB (see
// store.js), plus a global voice library. An empty `settings.modelName` means the bundled one.
//
// The runtime only takes URLs. The bundled files are resolved to extension URLs; imported blobs
// become `blob:` URLs, which has to happen in the background page: a blob URL dies with the
// document that created it.

/**
 * The checkpoint in the extension package. `scripts/package-assets.mjs` copies these files from
 * `models/phonon-31m-en/` into `src/models/phonon-31m-en/` before web-ext packs `src/`.
 */
export const BUNDLED_MODEL = {
  name: "phonon-31m-en",
  label: "Phonon 31M (bundled, English)",
  dir: "models/phonon-31m-en",
  weights: "model.q8.gguf",
  tokenizer: "tokenizer.json",
  config: "config.json",
  voice: "default-voice.safetensors",
  // The 31m checkpoint is English only; its config.json says the same. Not read at runtime,
  // so the options page can describe the model without fetching anything.
  languages: ["en"]
};

function defaultGetURL(path) {
  const runtime = globalThis.browser?.runtime ?? globalThis.chrome?.runtime;
  if (!runtime?.getURL) throw new Error("cannot read files from the extension package outside the browser");
  return runtime.getURL(path);
}

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
 * Describe the checkpoint the settings point at (the bundled one when `modelName` is empty) and
 * the voices that can speak with it. The model's own voices win over a library voice with the
 * same name (every checkpoint has `default`).
 * No URLs are made here; this is cheap enough for the options page to call on every visit.
 *
 * @param {object} options
 * @param {object} options.settings
 * @param {{ getModel: (name: string) => Promise<object | null>, allVoices?: () => Promise<object[]> }} options.store
 */
export async function describeModel({ settings, store }) {
  const library = ((await store?.allVoices?.()) ?? []).filter((voice) => voice?.name && voice.blob);

  if (!settings.modelName) {
    // The bundled checkpoint's own voice is `default`; a library voice may add more.
    const merged = ["default"];
    for (const voice of library) {
      if (!merged.includes(voice.name)) merged.push(voice.name);
    }
    return {
      source: "bundled",
      modelDir: BUNDLED_MODEL.name,
      voices: merged,
      modelVoices: ["default"],
      library,
      languages: BUNDLED_MODEL.languages,
      defaultVoice: merged.includes(settings.voice) ? settings.voice : "default"
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
 * with `URL.revokeObjectURL` when the model is disposed. The bundled checkpoint contributes no
 * blob URLs: its files are read straight from the extension package.
 *
 * @param {object} model
 * @param {{ getURL?: (path: string) => string }} [options]
 * @returns {{ spec: object, blobUrls: string[] }}
 */
export function buildSpec(model, { getURL = defaultGetURL } = {}) {
  const blobUrls = [];

  if (model.source === "bundled") {
    const file = (path) => getURL(`${BUNDLED_MODEL.dir}/${path}`);
    const voices = { default: file(BUNDLED_MODEL.voice) };
    for (const voice of model.library ?? []) {
      if (voices[voice.name]) continue;
      const value = URL.createObjectURL(voice.blob);
      blobUrls.push(value);
      voices[voice.name] = value;
    }
    return {
      blobUrls,
      spec: {
        weights: { q8: file(BUNDLED_MODEL.weights) },
        tokenizer: file(BUNDLED_MODEL.tokenizer),
        config: file(BUNDLED_MODEL.config),
        voices,
        defaultVoice: model.defaultVoice
      }
    };
  }

  if (model.source !== "imported") {
    throw new Error("No model is available. Open the extension settings and import a model folder.");
  }

  const record = model.record;
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
