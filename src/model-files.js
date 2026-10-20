// Turns the files from a folder picker into a checkpoint record the extension can store.
//
// Firefox gives a page `File` objects and a `webkitRelativePath` ("my-model/voices/x.safetensors"),
// never a path on disk. So the files are copied into browser storage once (see store.js), and
// the model is loaded from there afterwards. This module is the pure part: which files are
// there, which one is the voice manifest, and what is missing.
//
// Only what the runtime reads is kept. `hf download` fetches a whole repo, including extra
// quants and `tokenizer.model`, and copying those into IndexedDB would triple the size of an
// import for no benefit.

export const REQUIRED_FILES = ["config.json", "tokenizer.json"];
export const WEIGHT_FILES = ["model.q8.gguf", "model.safetensors"];
export const DEFAULT_VOICE_FILE = "default-voice.safetensors";
export const MANIFEST_FILE = "voices.json";

/** The common first path segment of `paths`, or "" when they do not share one. */
function sharedRoot(paths) {
  if (paths.length === 0) return "";
  const first = paths[0].split("/")[0];
  if (!paths.every((path) => path.startsWith(first + "/"))) return "";
  return first;
}

function cleanManifest(json) {
  const source = json && typeof json === "object" && !Array.isArray(json) ? json.voices ?? json : null;
  if (!source || typeof source !== "object" || Array.isArray(source)) return {};
  const manifest = {};
  for (const [name, path] of Object.entries(source)) {
    if (typeof name === "string" && name.trim() && typeof path === "string" && path.trim()) {
      manifest[name.trim()] = path.trim().replace(/^\.?\//, "");
    }
  }
  return manifest;
}

/**
 * @param {File[] | { name: string, size: number, webkitRelativePath?: string, text?: () => Promise<string> }[]} fileList
 * @returns {Promise<{ name: string, files: Record<string, Blob>, voices: Record<string, string>, defaultVoice: string, weights: string, bytes: number }>}
 */
export async function collectModelFiles(fileList) {
  const entries = [...(fileList ?? [])].filter((file) => file && file.size > 0);
  if (entries.length === 0) throw new Error("no files were selected");

  const paths = entries.map((file) => (file.webkitRelativePath || file.name).replace(/\\/g, "/"));
  const root = sharedRoot(paths);
  const all = {};
  entries.forEach((file, index) => {
    const path = root ? paths[index].slice(root.length + 1) : paths[index];
    all[path] = file;
  });

  const missing = REQUIRED_FILES.filter((name) => !all[name]);
  if (missing.length) throw new Error(`the folder has no ${missing.join(" or ")}`);

  const weights = WEIGHT_FILES.find((name) => all[name]);
  if (!weights) {
    if (all["model.q4k.gguf"]) {
      throw new Error("only model.q4k.gguf is there; this runtime loads model.q8.gguf or model.safetensors");
    }
    throw new Error(`the folder has no ${WEIGHT_FILES.join(" or ")}`);
  }

  let manifest = {};
  if (all[MANIFEST_FILE]) {
    let parsed;
    try {
      parsed = JSON.parse(await all[MANIFEST_FILE].text());
    } catch {
      throw new Error("voices.json is not valid JSON");
    }
    manifest = cleanManifest(parsed);
  } else if (all[DEFAULT_VOICE_FILE]) {
    manifest = { default: DEFAULT_VOICE_FILE };
  } else {
    // No manifest: every voice file directly under voices/ becomes a voice, named by its file.
    const found = Object.keys(all)
      .filter((path) => /^voices\/[^/]+\.safetensors$/i.test(path))
      .sort();
    if (found.length) manifest = { default: found[0] };
  }
  if (!manifest.default && all[DEFAULT_VOICE_FILE]) manifest = { default: DEFAULT_VOICE_FILE, ...manifest };

  for (const path of Object.values(manifest)) {
    if (!all[path]) throw new Error(`voices.json points at ${path}, which is not in the folder`);
  }
  if (Object.keys(manifest).length === 0) {
    throw new Error(`the folder has no voice file (${DEFAULT_VOICE_FILE} or voices.json)`);
  }

  // Keep only what the runtime opens: its config, tokenizer, the chosen weights and the voices
  // the manifest names.
  const keep = new Set([...REQUIRED_FILES, weights, DEFAULT_VOICE_FILE, ...Object.values(manifest)]);
  const files = {};
  let bytes = 0;
  for (const path of keep) {
    if (!all[path]) continue;
    files[path] = all[path];
    bytes += all[path].size || 0;
  }

  return {
    name: root || "imported-model",
    files,
    voices: manifest,
    defaultVoice: "default" in manifest ? "default" : Object.keys(manifest)[0],
    weights,
    bytes
  };
}
