// Turns picked voice files into library records. A voice is a small `.safetensors` file (about
// 256 KB) from gradium/phonon-voices or Gradium Studio; the browser build cannot clone voices,
// so these are ready-made ones.
//
// The catalog's files are named by voice id (`voices/NbpkqMVS3CJeq2j8.safetensors`), and only
// `voices.jsonl` says which is "Zoey" and what language it speaks. When that file is part of
// the pick, its names and descriptions are used; otherwise the file name is.

export const VOICE_EXTENSION = ".safetensors";
export const MAX_VOICE_BYTES = 16 * 1024 * 1024;
const MAX_HEADER_BYTES = 5 * 1024 * 1024;

function sharedRoot(paths) {
  if (paths.length === 0) return "";
  const first = paths[0].split("/")[0];
  if (!paths.every((path) => path.startsWith(first + "/"))) return "";
  return first;
}

function basename(path) {
  return path.split("/").pop();
}

function stem(path) {
  return basename(path).replace(/\.safetensors$/i, "");
}

/** Names and metadata from the catalog's `voices.jsonl`, keyed by path and by file name. */
function readJsonl(text) {
  const byPath = new Map();
  const byBase = new Map();
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (!entry || typeof entry !== "object" || typeof entry.filename !== "string") continue;
    const path = entry.filename.replace(/^\.?\//, "");
    if (typeof entry.name === "string" && entry.name.trim()) byPath.set(path, entry);
    if (typeof entry.name === "string" && entry.name.trim()) byBase.set(basename(path), entry);
  }
  return { byPath, byBase };
}

/** Names from a `voices.json` model manifest: `{ name: path }` or `{ voices: { name: path } }`. */
function readJson(json) {
  const source = json && typeof json === "object" && !Array.isArray(json) ? json.voices ?? json : null;
  const byPath = new Map();
  const byBase = new Map();
  if (!source || typeof source !== "object" || Array.isArray(source)) return { byPath, byBase };
  for (const [name, path] of Object.entries(source)) {
    if (typeof name !== "string" || !name.trim() || typeof path !== "string" || !path.trim()) continue;
    const clean = path.replace(/^\.?\//, "");
    byPath.set(clean, { name });
    byBase.set(basename(clean), { name });
  }
  return { byPath, byBase };
}

/** A cheap container check: the 8-byte header length, then JSON. Rejects model weights. */
async function looksLikeSafetensors(file) {
  if (typeof file.slice !== "function" || file.size < 16) return false;
  const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  if (head.length < 8) return false;
  const length = Number(new DataView(head.buffer, head.byteOffset, 8).getBigUint64(0, true));
  if (!Number.isSafeInteger(length) || length < 2 || length > MAX_HEADER_BYTES) return false;
  if (8 + length > file.size) return false;
  try {
    JSON.parse(await file.slice(8, 8 + length).text());
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {File[] | { name: string, size: number, webkitRelativePath?: string, slice?: Function, text?: Function }[]} fileList
 * @returns {Promise<{ voices: Array<{ name: string, blob: Blob, bytes: number, language?: string, description?: string }>, skipped: Array<{ path: string, reason: string }> }>}
 */
export async function collectVoiceFiles(fileList) {
  const entries = [...(fileList ?? [])].filter((file) => file && file.size > 0);
  if (entries.length === 0) throw new Error("no files were selected");

  const paths = entries.map((file) => (file.webkitRelativePath || file.name).replace(/\\/g, "/"));
  const root = sharedRoot(paths);
  const all = entries.map((file, index) => ({
    file,
    path: root ? paths[index].slice(root.length + 1) : paths[index]
  }));

  // A catalog listing may be anywhere in the pick; prefer the shallowest.
  const listing = all
    .filter(({ path }) => /(^|\/)voices\.jsonl$/i.test(path))
    .sort((a, b) => a.path.split("/").length - b.path.split("/").length)[0];
  const manifest = all.find(({ path }) => /(^|\/)voices\.json$/i.test(path));
  let names = { byPath: new Map(), byBase: new Map() };
  if (listing) {
    names = readJsonl(await listing.file.text());
  } else if (manifest) {
    try {
      names = readJson(JSON.parse(await manifest.file.text()));
    } catch {
      // A broken manifest only costs the friendly names; the files still import.
    }
  }

  const skipped = [];
  const voices = [];
  const used = new Set();

  for (const { file, path } of all) {
    if (!new RegExp(`${VOICE_EXTENSION}$`, "i").test(path)) continue;
    if (/^samples\//i.test(path)) continue; // the catalog's audio previews
    if (file.size > MAX_VOICE_BYTES) {
      skipped.push({ path, reason: `larger than ${MAX_VOICE_BYTES / 1024 / 1024} MB` });
      continue;
    }
    if (!(await looksLikeSafetensors(file))) {
      skipped.push({ path, reason: "not a safetensors file" });
      continue;
    }

    const info = names.byPath.get(path) ?? names.byBase.get(basename(path));
    const base = (info?.name || stem(path)).trim() || stem(path);
    let name = base;
    for (let suffix = 2; used.has(name.toLowerCase()); suffix++) name = `${base} (${suffix})`;
    used.add(name.toLowerCase());

    voices.push({
      name,
      blob: file,
      bytes: file.size,
      language: typeof info?.language === "string" ? info.language : undefined,
      description: typeof info?.description === "string" ? info.description : undefined,
      voiceId: typeof info?.voice_id === "string" ? info.voice_id : undefined
    });
  }

  if (voices.length === 0) {
    const detail = skipped.length ? ` (${skipped.length} file(s) skipped: ${skipped[0].reason})` : "";
    throw new Error(`no voice ${VOICE_EXTENSION} files found${detail}`);
  }
  return { voices, skipped };
}
