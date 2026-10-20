// Downloads a Phonon checkpoint from Hugging Face into a model folder the extension reads.
//
//   npm run fetch-model
//   npm run fetch-model -- --repo gradium/phonon-40m-multilingual --voice Zoey --voice Juniper
//
// The multilingual 40m repo is gated: accept its terms on the model page, then pass a
// read token (https://huggingface.co/settings/tokens) as HF_TOKEN or --token. The script
// never runs at runtime: once the files are imported in the extension, it is offline.

import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";

const HUB = "https://huggingface.co";
const VOICES_REPO = "gradium/phonon-voices";
const FILES = ["config.json", "tokenizer.json", "model.q8.gguf", "default-voice.safetensors"];
const DEFAULT_REPO = "gradium/phonon-40m-multilingual";
const DEFAULT_OUT = "models/phonon-40m-multilingual";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const options = { repo: DEFAULT_REPO, out: DEFAULT_OUT, token: "", voices: [], force: false, list: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => {
      const next = argv[++i];
      if (next === undefined) throw new Error(`${arg} needs a value`);
      return next;
    };
    switch (arg) {
      case "--repo":
        options.repo = value();
        break;
      case "--out":
        options.out = value();
        break;
      case "--token":
        options.token = value();
        break;
      case "--voice":
        options.voices.push(...value().split(",").map((v) => v.trim()).filter(Boolean));
        break;
      case "--force":
        options.force = true;
        break;
      case "--list-voices":
        options.list = true;
        break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
        break;
      default:
        throw new Error(`unknown option ${arg}`);
    }
  }
  return options;
}

function printHelp() {
  console.log(`Usage: npm run fetch-model -- [options]

  --repo <owner/name>   Hugging Face repo (default ${DEFAULT_REPO})
  --out <dir>           Model folder (default ${DEFAULT_OUT})
  --token <token>       Hugging Face token; or set HF_TOKEN
  --voice <name>        Also download a voice from ${VOICES_REPO};
                        repeat or comma-separate
  --list-voices         List the catalog and exit
  --force               Download again even if a file exists`);
}

function token(options) {
  return options.token || process.env.HF_TOKEN || process.env.HUGGING_FACE_HUB_TOKEN || "";
}

function headers(options) {
  const value = token(options);
  return value ? { authorization: `Bearer ${value}` } : {};
}

async function get(url, options, { allowMissing = false } = {}) {
  const response = await fetch(url, { headers: headers(options), redirect: "follow" });
  if (response.status === 401 || response.status === 403) {
    throw new Error(
      `${response.status} for ${url}\n` +
        "This repo is gated. Accept its terms on its Hugging Face page, create a read token at\n" +
        "https://huggingface.co/settings/tokens and pass it as HF_TOKEN or --token."
    );
  }
  if (allowMissing && response.status === 404) return null;
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return response;
}

async function downloadFile(url, destination, options) {
  if (!options.force) {
    try {
      const info = await stat(destination);
      if (info.size > 0) {
        console.log(`  = ${basename(destination)} (already there, ${mb(info.size)})`);
        return;
      }
    } catch {
      // Not downloaded yet.
    }
  }

  const response = await get(url, options);
  const total = Number(response.headers.get("content-length")) || 0;
  await mkdir(dirname(destination), { recursive: true });
  const part = destination + ".part";
  let loaded = 0;
  let lastReport = 0;
  const body = Readable.fromWeb(response.body);
  body.on("data", (chunk) => {
    loaded += chunk.length;
    const now = Date.now();
    if (now - lastReport < 200) return;
    lastReport = now;
    const percent = total ? ` ${Math.round((loaded / total) * 100)}%` : "";
    process.stdout.write(`\r  ↓ ${basename(destination)} ${mb(loaded)}${total ? " / " + mb(total) : ""}${percent}   `);
  });
  await pipeline(body, createWriteStream(part));
  await rename(part, destination);
  process.stdout.write(`\r  ✓ ${basename(destination)} ${mb(loaded)}${total ? " / " + mb(total) : ""}          \n`);
}

async function fetchVoiceCatalog(options) {
  const url = `${HUB}/${VOICES_REPO}/resolve/main/voices.jsonl`;
  const response = await get(url, options);
  const text = await response.text();
  return text
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

async function mergeManifest(outDir, entries) {
  const file = join(outDir, "voices.json");
  let manifest = { default: "default-voice.safetensors" };
  try {
    manifest = JSON.parse(await readFile(file, "utf8"));
  } catch {
    // First voice added, or the file was edited by hand.
  }
  Object.assign(manifest, entries);
  const ordered = { default: manifest.default ?? "default-voice.safetensors" };
  for (const [name, path] of Object.entries(manifest)) {
    if (name !== "default") ordered[name] = path;
  }
  await writeFile(file, JSON.stringify(ordered, null, 2) + "\n");
  console.log(`  ✓ voices.json (${Object.keys(ordered).length} voice${Object.keys(ordered).length === 1 ? "" : "s"})`);
}

function mb(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const outDir = join(root, options.out);

  if (options.list) {
    const catalog = await fetchVoiceCatalog(options);
    for (const voice of catalog) {
      console.log(`${voice.name.padEnd(18)} ${voice.language}  ${voice.voice_id}  ${voice.description ?? ""}`);
    }
    return;
  }

  if (!token(options)) console.log("No token set: fine for public repos, not for gated ones.\n");
  console.log(`Downloading ${options.repo} into ${options.out}`);
  for (const file of FILES) {
    await downloadFile(`${HUB}/${options.repo}/resolve/main/${file}`, join(outDir, file), options);
  }
  // Make the default voice usable even when no extra ones are picked.
  await mergeManifest(outDir, {});

  if (options.voices.length > 0) {
    const catalog = await fetchVoiceCatalog(options);
    const entries = {};
    for (const wanted of options.voices) {
      const voice =
        catalog.find((entry) => entry.name.toLowerCase() === wanted.toLowerCase()) ??
        catalog.find((entry) => entry.voice_id === wanted);
      if (!voice) {
        const names = catalog.map((entry) => entry.name).join(", ");
        throw new Error(`no voice '${wanted}' in ${VOICES_REPO}; known: ${names}`);
      }
      const destination = join(outDir, voice.filename);
      await downloadFile(`${HUB}/${VOICES_REPO}/resolve/main/${voice.filename}`, destination, options);
      entries[voice.name] = voice.filename;
    }
    await mergeManifest(outDir, entries);
  }

  console.log(`\nDone. Import "${options.out}" in the extension: Settings → Model → Import a model folder…`);
}

main().catch((error) => {
  console.error(`\n${error.message}`);
  process.exitCode = 1;
});
