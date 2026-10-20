// Turns the files from a folder picker into a checkpoint record the extension can store.
//
// Firefox gives a page `File` objects and a `webkitRelativePath` ("my-model/voices/x.safetensors"),
// never a path on disk. So the files are copied into browser storage once (see store.js), and
// the model is loaded from there afterwards. This module is the pure part: which files are
// there, which one is the voice manifest, and what is missing.

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
  const files = {};
  entries.forEach((file, index) => {
    const path = root ? paths[index].slice(root.length + 1) : paths[index];
    files[path] = file;
  });

  const missing = REQUIRED_FILES.filter((name) => !files[name]);
  if (missing.length) throw new Error(`the folder has no ${missing.join(" or ")}`);

  const weights = WEIGHT_FILES.find((name) => files[name]);
  if (!weights) throw new Error(`the folder has no ${WEIGHT_FILES.join(" or ")}`);

  let manifest = {};
  if (files[MANIFEST_FILE]) {
    let parsed;
    try {
      parsed = JSON.parse(await files[MANIFEST_FILE].text());
    } catch {
      throw new Error("voices.json is not valid JSON");
    }
    manifest = cleanManifest(parsed);
  } else if (files[DEFAULT_VOICE_FILE]) {
    manifest = { default: DEFAULT_VOICE_FILE };
  } else {
    // No manifest: every voice file directly under voices/ becomes a voice, named by its file.
    const found = Object.keys(files)
      .filter((path) => /^voices\/[^/]+\.safetensors$/i.test(path))
      .sort();
    if (found.length) manifest = { default: found[0] };
  }
  if (!manifest.default && files[DEFAULT_VOICE_FILE]) manifest = { default: DEFAULT_VOICE_FILE, ...manifest };

  for (const [voice, path] of Object.entries(manifest)) {
    if (!files[path]) throw new Error(`voices.json points at ${path}, which is not in the folder`);
    void voice;
  }
  if (Object.keys(manifest).length === 0) {
    throw new Error(`the folder has no voice file (${DEFAULT_VOICE_FILE} or voices.json)`);
  }

  return {
    name: root || "imported-model",
    files,
    voices: manifest,
    defaultVoice: "default" in manifest ? "default" : Object.keys(manifest)[0],
    weights,
    bytes: entries.reduce((total, file) => total + (file.size || 0), 0)
  };
}
