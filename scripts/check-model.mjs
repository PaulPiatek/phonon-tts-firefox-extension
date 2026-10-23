// Checks whether the bundled checkpoint still matches the commit pinned in
// THIRD_PARTY_NOTICES.md, and whether upstream has published a newer one.
//
//   npm run check-model
//   npm run check-model -- --commit <sha>   # compare against another revision
//
// Needs the network. Exits 0 when the local files match the pin, 1 when they do not: a newer
// upstream commit is reported but is not an error.

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { BUNDLED_MODEL } from "../src/model.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const HUB = "https://huggingface.co";
const REPO = `gradium/${BUNDLED_MODEL.name}`;
const LOCAL = join(root, BUNDLED_MODEL.dir);
const FILES = [
  BUNDLED_MODEL.config,
  BUNDLED_MODEL.tokenizer,
  BUNDLED_MODEL.weights,
  BUNDLED_MODEL.voice
];

function parseArgs(argv) {
  const options = { commit: "" };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--commit") {
      options.commit = argv[++i];
      if (!options.commit) throw new Error("--commit needs a revision");
    } else if (arg === "--help" || arg === "-h") {
      console.log(`Usage: npm run check-model -- [options]

  --commit <sha>   Compare against this revision instead of the pinned one.

Reads the pinned commit from THIRD_PARTY_NOTICES.md, hashes the files in
${BUNDLED_MODEL.dir}/ and compares them with the repository tree. Needs the network.`);
      process.exit(0);
    } else {
      throw new Error(`unknown option ${arg}`);
    }
  }
  return options;
}

const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");
const gitBlob = (buffer) =>
  createHash("sha1").update(`blob ${buffer.length}\0`).update(buffer).digest("hex");

function hashOf(buffer, entry) {
  return entry?.lfs ? sha256(buffer) : gitBlob(buffer);
}

function remoteHash(entry) {
  return entry?.lfs?.oid ?? entry?.oid ?? "";
}

async function tree(rev) {
  const response = await fetch(`${HUB}/api/models/${REPO}/tree/${rev}?recursive=true`);
  if (response.status === 401 || response.status === 403) {
    throw new Error(`${response.status} for ${REPO} at ${rev}: the repository needs an accepted licence and a token`);
  }
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${REPO} at ${rev}`);
  const entries = await response.json();
  if (!Array.isArray(entries)) throw new Error(`unexpected answer for ${REPO} at ${rev}`);
  return Object.fromEntries(entries.map((entry) => [entry.path, entry]));
}

function short(hash) {
  return hash ? hash.slice(0, 12) : "(missing)";
}

function size(bytes) {
  if (bytes === undefined) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  const notices = await readFile(join(root, "THIRD_PARTY_NOTICES.md"), "utf8");
  const pinned = options.commit || (notices.match(/at commit\s+`([0-9a-f]{40})`/) || [])[1];
  if (!pinned) {
    throw new Error(
      "no pinned commit in THIRD_PARTY_NOTICES.md; add `at commit `<sha>`` to the bundled model section or pass --commit"
    );
  }

  const meta = await (await fetch(`${HUB}/api/models/${REPO}`)).json();
  if (!meta?.sha) throw new Error(`cannot read ${REPO} from the Hugging Face API`);

  const [pinnedTree, mainTree] = await Promise.all([tree(pinned), tree(meta.sha)]);

  console.log(`Checking ${REPO}`);
  console.log(`Pinned commit: ${pinned}${options.commit ? " (from --commit)" : " (THIRD_PARTY_NOTICES.md)"}`);
  console.log(`Upstream main: ${meta.sha}`);
  console.log("");

  let localMatches = true;
  let upstreamChanged = false;
  const width = Math.max(...FILES.map((file) => file.length));

  for (const file of FILES) {
    const entry = pinnedTree[file];
    if (!entry) {
      console.log(`  ${file.padEnd(width)}  MISSING upstream at the pin`);
      localMatches = false;
      continue;
    }

    let buffer;
    try {
      buffer = await readFile(join(LOCAL, file));
    } catch {
      console.log(`  ${file.padEnd(width)}  missing in ${BUNDLED_MODEL.dir}/`);
      localMatches = false;
      continue;
    }

    const local = hashOf(buffer, entry);
    const ok = local === remoteHash(entry);
    if (!ok) localMatches = false;

    const mainEntry = mainTree[file];
    const mainHash = remoteHash(mainEntry);
    let note = "unchanged upstream";
    if (!mainEntry) {
      note = "removed upstream";
      upstreamChanged = true;
    } else if (mainHash !== remoteHash(entry)) {
      note = `upstream ${short(remoteHash(entry))} -> ${short(mainHash)} (${size(mainEntry.size)})`;
      upstreamChanged = true;
    }

    console.log(`  ${file.padEnd(width)}  ${ok ? "ok      " : "MISMATCH"}  ${short(local)}  ${note}`);
  }

  console.log("");

  if (!localMatches) {
    console.log(`The files in ${BUNDLED_MODEL.dir}/ do not match the pinned commit.`);
    console.log("Download them from that commit, or update the pin in THIRD_PARTY_NOTICES.md.");
    process.exitCode = 1;
    return;
  }

  if (upstreamChanged) {
    console.log("Update available: upstream main has newer model files.");
    console.log(`Refresh ${BUNDLED_MODEL.dir}/ and update the pin in THIRD_PARTY_NOTICES.md.`);
  } else if (meta.sha !== pinned) {
    console.log("Upstream main moved, but the bundled files are identical: nothing to download.");
  } else {
    console.log("No update: upstream main is the pinned commit and the files match.");
  }
}

main().catch((error) => {
  console.error(`\n${error.message}`);
  process.exitCode = 1;
});
