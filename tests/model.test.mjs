import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { buildSpec, describeModel } from "../src/model.js";

function record(name = "my-model") {
  return {
    name,
    files: {
      "config.json": new Blob(["config"]),
      "tokenizer.json": new Blob(["tokenizer"]),
      "model.q8.gguf": new Blob(["weights"]),
      "default-voice.safetensors": new Blob(["voice"]),
      "voices/anna.safetensors": new Blob(["anna"])
    },
    weights: "model.q8.gguf",
    voices: { default: "default-voice.safetensors", Anna: "voices/anna.safetensors" },
    defaultVoice: "default",
    bytes: 100
  };
}

describe("describeModel", () => {
  test("reports that nothing is imported yet, but still lists the voice library", async () => {
    const store = {
      getModel: async () => null,
      allVoices: async () => [{ name: "Zoey", blob: new Blob(["z"]) }]
    };
    const model = await describeModel({ settings: { modelName: "" }, store });
    assert.equal(model.source, "none");
    assert.deepEqual(model.voices, []);
    assert.deepEqual(
      model.library.map((voice) => voice.name),
      ["Zoey"]
    );
  });

  test("surfaces the voices of the imported model", async () => {
    const store = { getModel: async (name) => ({ ...record(name), defaultVoice: "Anna" }) };
    const model = await describeModel({ settings: { modelName: "my-model" }, store });
    assert.equal(model.source, "imported");
    assert.equal(model.modelDir, "my-model");
    assert.deepEqual(model.voices, ["default", "Anna"]);
    assert.equal(model.defaultVoice, "Anna");
  });

  test("uses the chosen voice and falls back to the record's default", async () => {
    const store = { getModel: async (name) => record(name) };
    const chosen = await describeModel({ settings: { modelName: "m", voice: "Anna" }, store });
    assert.equal(chosen.defaultVoice, "Anna");

    const gone = await describeModel({ settings: { modelName: "m", voice: "Deleted" }, store });
    assert.equal(gone.defaultVoice, "default");
  });

  test("library voices join the model's, and a model voice shadows one with the same name", async () => {
    const library = [
      { name: "Zoey", blob: new Blob(["zoey"]), bytes: 4, language: "en", description: "Playful" },
      { name: "default", blob: new Blob(["other"]), bytes: 5 }
    ];
    const store = { getModel: async (name) => record(name), allVoices: async () => library };

    const model = await describeModel({ settings: { modelName: "m", voice: "Zoey" }, store });
    assert.deepEqual(model.voices, ["default", "Anna", "Zoey"]);
    assert.deepEqual(model.modelVoices, ["default", "Anna"]);
    assert.equal(model.defaultVoice, "Zoey");
    assert.deepEqual(
      model.library.map((voice) => voice.name),
      ["Zoey", "default"],
      "the library still lists the shadowed one, for the UI to mark"
    );
  });

  test("reads the model's languages from its config", async () => {
    const base = record();
    const model = await describeModel({
      settings: { modelName: "m" },
      store: {
        getModel: async () => ({
          ...base,
          files: { ...base.files, "config.json": new Blob([JSON.stringify({ languages: ["en", "de"] })]) }
        })
      }
    });
    assert.deepEqual(model.languages, ["en", "de"]);
  });

  test("an unreadable config just means no language list", async () => {
    const model = await describeModel({
      settings: { modelName: "m" },
      store: { getModel: async (name) => record(name) }
    });
    assert.deepEqual(model.languages, [], "the test record's config is not JSON");
  });

  test("a deleted imported model is an error worth showing", async () => {
    const store = { getModel: async () => null };
    await assert.rejects(
      describeModel({ settings: { modelName: "gone" }, store }),
      /no longer in browser storage/
    );
  });

  test("an imported model without any voice is refused", async () => {
    const store = { getModel: async (name) => ({ name, files: {}, voices: {}, weights: "model.q8.gguf" }) };
    await assert.rejects(describeModel({ settings: { modelName: "m" }, store }), /no voice file/);
  });
});

describe("buildSpec", () => {
  test("refuses to build anything until a model is imported", () => {
    assert.throws(() => buildSpec({ source: "none" }), /No model imported yet/);
  });

  test("makes blob URLs for every file of the imported model", (t) => {
    const made = [];
    const revoked = [];
    t.mock.method(URL, "createObjectURL", (blob) => {
      made.push(blob);
      return `blob:test/${made.length}`;
    });
    t.mock.method(URL, "revokeObjectURL", (url) => revoked.push(url));

    const { spec, blobUrls } = buildSpec({
      source: "imported",
      defaultVoice: "Anna",
      record: record()
    });

    assert.deepEqual(spec.voices, { default: "blob:test/1", Anna: "blob:test/2" });
    assert.equal(spec.weights.q8, "blob:test/3");
    assert.equal(spec.tokenizer, "blob:test/4");
    assert.equal(spec.config, "blob:test/5");
    assert.equal(spec.defaultVoice, "Anna");
    assert.deepEqual(blobUrls, ["blob:test/1", "blob:test/2", "blob:test/3", "blob:test/4", "blob:test/5"]);
    assert.deepEqual(revoked, [], "the caller revokes them when the model is disposed");
  });

  test("adds library voices, skipping one the model shadows", (t) => {
    let count = 0;
    t.mock.method(URL, "createObjectURL", () => `blob:test/${++count}`);

    const { spec, blobUrls } = buildSpec({
      source: "imported",
      defaultVoice: "Zoey",
      record: record(),
      library: [
        { name: "Zoey", blob: new Blob(["zoey"]) },
        { name: "default", blob: new Blob(["shadowed"]) }
      ]
    });

    assert.deepEqual(spec.voices, {
      default: "blob:test/1",
      Anna: "blob:test/2",
      Zoey: "blob:test/3"
    });
    assert.equal(spec.weights.q8, "blob:test/4");
    assert.equal(blobUrls.length, 6);
  });

  test("refuses a record whose files are incomplete", () => {
    assert.throws(
      () =>
        buildSpec({
          source: "imported",
          defaultVoice: "default",
          record: {
            name: "m",
            files: { "config.json": new Blob(["x"]) },
            weights: "model.q8.gguf",
            voices: { default: "default-voice.safetensors" }
          }
        }),
      /missing default-voice\.safetensors/
    );
  });
});
