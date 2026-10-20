// Where the checkpoint is: a folder the user picked in the options page, validated by
// model-files.js and stored in IndexedDB by store.js. There is no bundled model, so until one
// is imported there is nothing to speak with.
//
// The runtime only takes URLs, so `buildSpec` turns the stored blobs into `blob:` URLs. That
// has to happen in the background page: a blob URL dies with the document that created it.

/**
 * Describe the imported checkpoint, without making any URLs. Cheap enough for the options
 * page to call on every visit.
 *
 * @param {object} options
 * @param {object} options.settings
 * @param {{ getModel: (name: string) => Promise<object | null> }} options.store
 * @returns {Promise<{ source: 'none' | 'imported', modelDir: string, voices: string[], defaultVoice: string | null, record?: object }>}
 */
export async function describeModel({ settings, store }) {
  if (!settings.modelName) {
    return { source: "none", modelDir: "", voices: [], defaultVoice: null };
  }
  if (!store) throw new Error("imported models are not available in this browser");

  const record = await store.getModel(settings.modelName);
  if (!record) {
    throw new Error(
      `the imported model '${settings.modelName}' is no longer in browser storage; import it again`
    );
  }

  const voices = Object.keys(record.voices ?? {});
  if (voices.length === 0) throw new Error(`the imported model '${record.name}' has no voice file`);
  const defaultVoice =
    settings.voice && record.voices[settings.voice]
      ? settings.voice
      : record.voices[record.defaultVoice]
        ? record.defaultVoice
        : voices[0];

  return {
    source: "imported",
    modelDir: record.name,
    voices,
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

  const voices = {};
  for (const [name, path] of Object.entries(record.voices)) voices[name] = url(path);

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
