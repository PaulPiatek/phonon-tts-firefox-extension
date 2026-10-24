// Renders THIRD_PARTY_RUST.md from the committed cargo-about inventory in
// third-party/xn-ptts-<version>.json.
//
// The inventory is the output of a Rust toolchain: cargo-about reads the Cargo.lock at an upstream
// commit and collects each crate's licence files. That step must not run in `npm run build` — the
// build is Node-only and must stay reproducible without Rust — so its output is committed and this
// script only formats it. Re-run the toolchain by hand when `phonon-tts` is bumped; the commands
// are in AGENTS.md.
//
//   node scripts/rust-licenses.mjs          # rewrite the notices
//   node scripts/rust-licenses.mjs --check  # exit non-zero if they are stale (npm test)

import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
export const INVENTORY = join(root, "third-party", "xn-ptts-0.4.1.json");
export const OUTPUT = join(root, "THIRD_PARTY_RUST.md");

const WIDTH = 96;

/**
 * Git stores LF. A crate's licence file may ship CRLF or a stray CR, so normalise before it
 * reaches the document; otherwise the committed bytes and a fresh checkout disagree.
 */
export const normalizeEol = (text) => text.replace(/\r\n?/g, "\n");

/** Reflow a paragraph to the column width, so the source stays readable whatever its length. */
function wrap(text, width = WIDTH) {
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  const lines = [];
  let line = "";
  for (const word of words) {
    if (line && line.length + 1 + word.length > width) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines.join("\n");
}

/** Join items with commas, wrapping between them so long crate lists stay readable. */
function wrapList(items, width = WIDTH) {
  const lines = [];
  let line = "";
  for (const item of items) {
    const candidate = line ? `${line}, ${item}` : item;
    if (line && candidate.length > width) {
      lines.push(`${line},`);
      line = item;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines.join("\n");
}

function buildLabel(builds) {
  if (builds.length === 2) return "both";
  return builds[0] === "wasm-threads" ? "threads" : "wasm";
}

function compareCrates(a, b) {
  const left = a.name.toLowerCase();
  const right = b.name.toLowerCase();
  if (left !== right) return left < right ? -1 : 1;
  if (a.name !== b.name) return a.name < b.name ? -1 : 1;
  return a.version < b.version ? -1 : a.version > b.version ? 1 : 0;
}

/** Render the whole document. Exported so the test can compare without writing a file. */
export function render(inventory) {
  const { upstream, crates: unsorted, licenses } = inventory;
  const crates = [...unsorted].sort(compareCrates);
  const withThreads = crates.filter((c) => c.builds.includes("wasm-threads")).length;
  const withoutThreads = crates.filter((c) => c.builds.includes("wasm")).length;
  const threadOnly = crates
    .filter((c) => c.builds.length === 1 && c.builds[0] === "wasm-threads")
    .map((c) => `\`${c.name}\``)
    .sort();

  const unlicensed = crates.filter((c) => !c.license).map((c) => `${c.name} ${c.version}`);
  if (unlicensed.length) {
    throw new Error(`no licence for: ${unlicensed.join(", ")}`);
  }
  if ((upstream.notice_files ?? []).length) {
    throw new Error(
      `crates ship NOTICE files (${upstream.notice_files.join(", ")}): Apache-2.0 §4(d) requires ` +
        "reproducing them, so the inventory and this renderer need to carry them"
    );
  }

  // A crate version can legitimately appear under two texts: see the sentence in "Licence texts".
  const blocks = new Map();
  for (const licence of licenses) {
    for (const id of licence.used_by) blocks.set(id, (blocks.get(id) ?? 0) + 1);
  }
  const repeated = [...blocks.values()].filter((n) => n > 1).length;

  const tool = upstream.tool.replace(/^cargo-about\s*/, "");

  const out = [];
  const para = (text) => {
    out.push(wrap(text), "");
  };

  out.push("# Third-party Rust crates", "");
  para(
    "The extension bundles two WebAssembly builds of " +
      "[`phonon-tts`](https://www.npmjs.com/package/phonon-tts), part of " +
      `[xn-ptts](${upstream.repository}) by Gradium. Both were built from tag \`${upstream.tag}\` ` +
      `(commit \`${upstream.commit}\`, committed ${upstream.commit_date}), whose \`Cargo.lock\` ` +
      `hashes to \`${upstream.cargo_lock_sha256}\`. The npm package is \`${upstream.npm_package}\`, ` +
      "pinned in `package-lock.json` by the integrity below."
  );
  out.push("```text", upstream.npm_integrity, "```", "");
  para(
    `\`wasm/\` is built with \`--features ${upstream.builds.wasm}\` and \`wasm-threads/\` with ` +
      `\`--features ${upstream.builds["wasm-threads"]}\`, both for \`${upstream.target}\`.`
  );
  para(
    `${crates.length} crates are linked into the two modules: ${withoutThreads} in \`wasm/\`, ` +
      `${withThreads} in \`wasm-threads/\`, which adds ${threadOnly.join(", ")}.`
  );

  out.push("## What this list covers", "");
  para(
    `The crate set is the \`cargo tree -e normal\` closure of the \`ptts-wasm\` package for ` +
      `\`${upstream.target}\`, cross-checked against cargo-about ${tool}. That is narrower than ` +
      "cargo-about's defaults, which also list the workspace's build and dev dependencies — " +
      "`clap`, `anyhow` and `ptts-coreml` among them — none of which is linked into the modules."
  );
  out.push(
    wrap(
      `- Crates that exist only as proc macros (${upstream.cargo_tree.wasm.proc_macro_only_omitted} of them) are omitted: they run at build time and no code from them is linked in.`
    ),
    wrap(
      "- Build dependencies of build dependencies, and the crates of the other workspace members " +
        "(`ptts-openai-server`, `ptts-ws-server`, `ptts-pyo3`, the CLI), are not linked and are not listed."
    ),
    wrap(
      "- Rust's own `core`, `alloc` and `std`, `compiler_builtins` and the allocator are linked " +
        "into every Rust WebAssembly module but are not Cargo crates, so they have no entry here. " +
        "They are MIT OR Apache-2.0, `compiler_builtins` with the LLVM exception."
    ),
    wrap(
      "- `ptts`, `ptts-wasm` and the `wasm-bindgen-rayon` worker helper are xn-ptts itself and its " +
        "helper rather than third-party code. They are in the table because they declare a licence, " +
        "and they are covered in [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) along with the rest of xn-ptts."
    ),
    wrap(
      "- A few crates still declare their licence in the pre-SPDX crates.io forms " +
        "`MIT/Apache-2.0`, `Apache-2.0/MIT` or `Apache-2.0 / MIT`; the table reproduces what each " +
        'manifest says. All of them mean "or".'
    ),
    "",
    wrap(
      "Every crate in the list has a licence. There are no unresolved or unknown entries, and no " +
        "crate is distributed here under a licence this file fails to state."
    ),
    ""
  );

  out.push("## Crates", "");
  out.push("| Crate | Version | Licence as declared | Builds |");
  out.push("| --- | --- | --- | --- |");
  for (const crate of crates) {
    const name = crate.repository ? `[${crate.name}](${crate.repository})` : crate.name;
    out.push(`| ${name} | ${crate.version} | ${crate.license} | ${buildLabel(crate.builds)} |`);
  }
  out.push("");

  out.push("## Licence texts", "");
  para(
    "Each licence below is reproduced once and names the crates it covers. Where two crates ship " +
      "the same licence with different formatting, one copy is kept; where the copyright line " +
      "differs — as it does for most MIT-licensed crates — each is kept."
  );
  para(
    "Crates that offer `MIT OR Apache-2.0` are reproduced under the Apache-2.0 text. That is the " +
      "stricter of the two branches, so complying with it satisfies both, and it does not narrow " +
      "the `MIT OR Apache-2.0` grant each recipient already holds from the crate's author: the " +
      "choice remains theirs. None of these crates ships a `NOTICE` file, so Apache-2.0 §4(d) has " +
      "nothing further to reproduce."
  );
  if (repeated) {
    para(
      "A crate version appears under more than one text when more than one licence applies to it: " +
        "an expression that joins licences with `AND`, or a separate licence file for code the " +
        "crate bundles. Both are reproduced here; the table still lists each crate version once."
    );
  }

  for (const licence of licenses) {
    const names = licence.used_by
      .map((id) => {
        const at = id.lastIndexOf("@");
        return `${id.slice(0, at)} ${id.slice(at + 1)}`;
      })
      .sort((a, b) => compareCrates(
        { name: a.split(" ")[0], version: a.split(" ")[1] },
        { name: b.split(" ")[0], version: b.split(" ")[1] }
      ));
    out.push(`### ${licence.id}`, "");
    out.push(`Applies to ${names.length} crate${names.length === 1 ? "" : "s"}:`, "");
    out.push(wrapList(names), "");
    out.push("```text");
    out.push(normalizeEol(licence.text));
    out.push("```");
    out.push("");
  }

  return `${out.join("\n").trimEnd()}\n`;
}

async function main() {
  const inventory = JSON.parse(await readFile(INVENTORY, "utf8"));
  const wanted = render(inventory);
  const check = process.argv.includes("--check");

  if (check) {
    let current = "";
    try {
      current = await readFile(OUTPUT, "utf8");
    } catch {
      // missing counts as stale
    }
    if (normalizeEol(current) !== normalizeEol(wanted)) {
      console.error(`${relative(root, OUTPUT)} is out of date; run: node scripts/rust-licenses.mjs`);
      process.exit(1);
    }
    console.log(`${relative(root, OUTPUT)} is up to date`);
    return;
  }

  await writeFile(OUTPUT, wanted);
  console.log(
    `wrote ${relative(root, OUTPUT)}: ${inventory.crates.length} crates, ` +
      `${inventory.licenses.length} licence texts`
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
