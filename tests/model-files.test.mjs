import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { collectModelFiles } from "../src/model-files.js";

function file(path, content = "x") {
  const name = path.split("/").pop();
  return {
    name,
    size: content.length,
    webkitRelativePath: path,
    async text() {
      return content;
    }
  };
}

const config = file("m/config.json", "{}");
const tokenizer = file("m/tokenizer.json", "{}");
const weights = file("m/model.q8.gguf", "gguf-bytes");
const voice = file("m/default-voice.safetensors", "voice-bytes");

describe("collectModelFiles", () => {
  test("accepts a whole model folder and strips the folder name from paths", async () => {
    const record = await collectModelFiles([config, tokenizer, weights, voice]);
    assert.equal(record.name, "m");
    assert.deepEqual(Object.keys(record.files).sort(), [
      "config.json",
      "default-voice.safetensors",
      "model.q8.gguf",
      "tokenizer.json"
    ]);
    assert.equal(record.weights, "model.q8.gguf");
    assert.deepEqual(record.voices, { default: "default-voice.safetensors" });
    assert.equal(record.defaultVoice, "default");
    assert.equal(record.bytes, 2 + 2 + 10 + 11);
  });

  test("prefers the q8 gguf when both weight files are there", async () => {
    const record = await collectModelFiles([
      config,
      tokenizer,
      weights,
      file("m/model.safetensors", "f32"),
      voice
    ]);
    assert.equal(record.weights, "model.q8.gguf");
  });

  test("accepts f32 safetensors alone", async () => {
    const record = await collectModelFiles([config, tokenizer, file("m/model.safetensors", "f32"), voice]);
    assert.equal(record.weights, "model.safetensors");
  });

  test("explains what is missing", async () => {
    await assert.rejects(collectModelFiles([weights, voice]), /config\.json/);
    await assert.rejects(collectModelFiles([config, voice]), /tokenizer\.json/);
    await assert.rejects(collectModelFiles([config, tokenizer, voice]), /model\.q8\.gguf or model\.safetensors/);
    await assert.rejects(collectModelFiles([config, tokenizer, weights]), /no voice file/);
    await assert.rejects(collectModelFiles([]), /no files/);
  });

  test("reads voices.json and keeps only the voices that are in the folder", async () => {
    const manifest = JSON.stringify({
      default: "default-voice.safetensors",
      Zoey: "voices/zoe.safetensors"
    });
    const record = await collectModelFiles([
      config,
      tokenizer,
      weights,
      voice,
      file("m/voices.json", manifest),
      file("m/voices/zoe.safetensors", "zoe")
    ]);
    assert.deepEqual(record.voices, {
      default: "default-voice.safetensors",
      Zoey: "voices/zoe.safetensors"
    });
    assert.equal(record.defaultVoice, "default");
  });

  test("accepts the wrapped voices.json shape", async () => {
    const manifest = JSON.stringify({ voices: { Anna: "voices/anna.safetensors" } });
    const record = await collectModelFiles([
      config,
      tokenizer,
      weights,
      file("m/voices.json", manifest),
      file("m/voices/anna.safetensors", "anna")
    ]);
    assert.deepEqual(record.voices, { Anna: "voices/anna.safetensors" });
    assert.equal(record.defaultVoice, "Anna");
  });

  test("fails when voices.json names a file that was not picked", async () => {
    const manifest = JSON.stringify({ Anna: "voices/anna.safetensors" });
    await assert.rejects(
      collectModelFiles([config, tokenizer, weights, file("m/voices.json", manifest)]),
      /voices\/anna\.safetensors, which is not in the folder/
    );
  });

  test("fails on a broken voices.json", async () => {
    await assert.rejects(
      collectModelFiles([config, tokenizer, weights, file("m/voices.json", "{oops")]),
      /not valid JSON/
    );
  });

  test("falls back to the voice files under voices/", async () => {
    const record = await collectModelFiles([
      config,
      tokenizer,
      weights,
      file("m/voices/b.safetensors", "b"),
      file("m/voices/a.safetensors", "a")
    ]);
    assert.deepEqual(record.voices, { default: "voices/a.safetensors" });
    assert.equal(record.defaultVoice, "default");
  });

  test("works with loose files that share no folder", async () => {
    const loose = ["config.json", "tokenizer.json", "model.q8.gguf", "default-voice.safetensors"].map((name) =>
      file(name, name)
    );
    const record = await collectModelFiles(loose);
    assert.equal(record.name, "imported-model");
    assert.ok(record.files["config.json"]);
  });

  test("keeps only the files the runtime opens when a whole repo was downloaded", async () => {
    const record = await collectModelFiles([
      config,
      tokenizer,
      weights,
      file("m/model.q4k.gguf", "q4k"),
      file("m/model.safetensors", "f32"),
      file("m/tokenizer.model", "spm"),
      file("m/README.md", "readme"),
      file("m/.gitattributes", "attrs"),
      voice
    ]);
    assert.deepEqual(Object.keys(record.files).sort(), [
      "config.json",
      "default-voice.safetensors",
      "model.q8.gguf",
      "tokenizer.json"
    ]);
    assert.equal(record.bytes, 2 + 2 + 10 + 11, "the ignored files do not count");
  });

  test("a q4k-only download is refused with an explanation", async () => {
    await assert.rejects(
      collectModelFiles([config, tokenizer, file("m/model.q4k.gguf", "q4k"), voice]),
      /q4k.*runtime loads model\.q8\.gguf or model\.safetensors/
    );
  });
});
