import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { collectVoiceFiles } from "../src/voice-files.js";

function safetensors(header = { emb: { dtype: "F32", shape: [1], data_offsets: [0, 0] } }) {
  const json = JSON.stringify(header);
  const bytes = new Uint8Array(8 + json.length);
  new DataView(bytes.buffer).setBigUint64(0, BigInt(json.length), true);
  for (let i = 0; i < json.length; i++) bytes[8 + i] = json.charCodeAt(i);
  return bytes;
}

function voice(path, bytes = safetensors()) {
  const blob = new Blob([bytes]);
  return {
    name: path.split("/").pop(),
    size: blob.size,
    webkitRelativePath: path,
    slice: (start, end) => blob.slice(start, end),
    text: () => blob.text()
  };
}

function listing(entries) {
  const text = entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n";
  const blob = new Blob([text]);
  return {
    name: "voices.jsonl",
    size: blob.size,
    webkitRelativePath: "catalog/voices.jsonl",
    slice: (start, end) => blob.slice(start, end),
    text: () => blob.text()
  };
}

const zoey = {
  filename: "voices/NbpkqMVS3CJeq2j8.safetensors",
  name: "Zoey",
  voice_id: "NbpkqMVS3CJeq2j8",
  language: "en",
  locale: "en-us",
  description: "Playful, upbeat and Gen Z energy voice."
};
const juniper = {
  filename: "voices/NIWIOv5vTi5eRMj8.safetensors",
  name: "Juniper",
  voice_id: "NIWIOv5vTi5eRMj8",
  language: "en",
  locale: "en-us",
  description: "Cheerful presence with real resonance."
};

describe("collectVoiceFiles", () => {
  test("uses voices.jsonl for names, languages and descriptions", async () => {
    const { voices, skipped } = await collectVoiceFiles([
      listing([zoey, juniper]),
      voice("catalog/voices/NbpkqMVS3CJeq2j8.safetensors"),
      voice("catalog/voices/NIWIOv5vTi5eRMj8.safetensors"),
      voice("catalog/samples/preview.safetensors", safetensors())
    ]);
    assert.equal(skipped.length, 0, "non-voice files are ignored quietly");
    assert.deepEqual(
      voices.map((entry) => entry.name),
      ["Zoey", "Juniper"]
    );
    assert.equal(voices[0].language, "en");
    assert.match(voices[0].description, /Playful/);
    assert.equal(voices[0].voiceId, "NbpkqMVS3CJeq2j8");
  });

  test("falls back to file names when there is no listing", async () => {
    const { voices } = await collectVoiceFiles([
      voice("Anna.safetensors"),
      voice("voices/custom_voice.safetensors")
    ]);
    assert.deepEqual(
      voices.map((entry) => entry.name),
      ["Anna", "custom_voice"]
    );
  });

  test("reads a voices.json model manifest too", async () => {
    const manifest = new Blob([JSON.stringify({ Anna: "voices/anna.safetensors" })]);
    const manifestFile = {
      name: "voices.json",
      size: manifest.size,
      webkitRelativePath: "pack/voices.json",
      slice: (start, end) => manifest.slice(start, end),
      text: () => manifest.text()
    };
    const { voices } = await collectVoiceFiles([manifestFile, voice("pack/voices/anna.safetensors")]);
    assert.deepEqual(voices.map((entry) => entry.name), ["Anna"]);
  });

  test("skips files that are not safetensors and says why when nothing is left", async () => {
    await assert.rejects(
      collectVoiceFiles([voice("not-a-voice.safetensors", new TextEncoder().encode("hello world, not a tensor"))]),
      /not a safetensors file/
    );

    const { voices, skipped } = await collectVoiceFiles([
      voice("Zoey.safetensors"),
      voice("broken.safetensors", new TextEncoder().encode("definitely not safetensors at all"))
    ]);
    assert.deepEqual(voices.map((entry) => entry.name), ["Zoey"]);
    assert.equal(skipped.length, 1);
    assert.match(skipped[0].reason, /not a safetensors/);
  });

  test("skips oversized files before reading them", async () => {
    const huge = {
      name: "huge.safetensors",
      size: 20 * 1024 * 1024,
      webkitRelativePath: "huge.safetensors",
      slice() {
        throw new Error("must not be read");
      },
      text() {
        throw new Error("must not be read");
      }
    };
    const { voices, skipped } = await collectVoiceFiles([huge, voice("Zoey.safetensors")]);
    assert.deepEqual(voices.map((entry) => entry.name), ["Zoey"]);
    assert.match(skipped[0].reason, /larger than/);
  });

  test("gives duplicate names a suffix instead of losing a voice", async () => {
    const { voices } = await collectVoiceFiles([
      voice("a/Zoey.safetensors"),
      voice("b/Zoey.safetensors"),
      voice("c/zoey.safetensors")
    ]);
    assert.deepEqual(voices.map((entry) => entry.name), ["Zoey", "Zoey (2)", "zoey (3)"]);
  });

  test("rejects an empty pick", async () => {
    await assert.rejects(collectVoiceFiles([]), /no files/);
  });
});
