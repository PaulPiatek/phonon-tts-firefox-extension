import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { INVENTORY, OUTPUT, normalizeEol, render } from "../scripts/rust-licenses.mjs";

async function inventory() {
  return JSON.parse(await readFile(INVENTORY, "utf8"));
}

describe("third-party Rust notices", () => {
  test("THIRD_PARTY_RUST.md is rendered from the committed inventory", async () => {
    const data = await inventory();
    assert.equal(normalizeEol(await readFile(OUTPUT, "utf8")), render(data));
  });

  test("every linked crate has a licence, and none is unknown", async () => {
    const { crates } = await inventory();
    assert.ok(crates.length > 100, `only ${crates.length} crates listed`);

    const missing = crates.filter((c) => !c.license || /unknown/i.test(c.license));
    assert.deepEqual(missing.map((c) => `${c.name} ${c.version}`), []);
  });

  test("the inventory is pinned to the phonon-tts version this repo depends on", async () => {
    const { upstream } = await inventory();
    const pinned = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"))
      .devDependencies["phonon-tts"];
    assert.equal(upstream.npm_package, `phonon-tts ${pinned}`);
  });

  test("the upstream pin is a real commit and lock hash, not a placeholder", async () => {
    const { upstream } = await inventory();
    assert.match(upstream.commit, /^[0-9a-f]{40}$/);
    assert.match(upstream.cargo_lock_sha256, /^[0-9a-f]{64}$/);
    assert.match(upstream.npm_integrity, /^sha512-/);
  });

  test("the shipped notice carries every licence text and no placeholder", async () => {
    const text = normalizeEol(await readFile(OUTPUT, "utf8"));
    assert.doesNotMatch(text, /UNKNOWN/);
    assert.doesNotMatch(text, /\[Link zum Issue\]|XXXXXXX|YYYYYYY/);
    for (const licence of (await inventory()).licenses) {
      assert.ok(text.includes(normalizeEol(licence.text)), `${licence.id} text missing`);
    }
  });

  test("the main notices link to the Rust notices and the build copies them", async () => {
    const notices = await readFile(new URL("../THIRD_PARTY_NOTICES.md", import.meta.url), "utf8");
    assert.match(notices, /\(THIRD_PARTY_RUST\.md\)/);

    const packaging = await readFile(
      new URL("../scripts/package-assets.mjs", import.meta.url),
      "utf8"
    );
    assert.match(packaging, /THIRD_PARTY_RUST\.md/);
  });
});
