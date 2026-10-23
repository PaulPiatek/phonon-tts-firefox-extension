import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { DEFAULTS, normalizeSettings, readSettings } from "../src/settings.js";

describe("normalizeSettings", () => {
  test("fills every default from an empty store", () => {
    assert.deepEqual(normalizeSettings(undefined), DEFAULTS);
    assert.deepEqual(normalizeSettings({}), DEFAULTS);
    assert.equal(DEFAULTS.modelName, "", "no model until one is imported");
  });

  test("keeps valid values", () => {
    const settings = normalizeSettings({
      lang: "de",
      voice: "Anna",
      device: "webgpu",
      temperature: 0.75,
      durationDelta: -0.25,
      modelName: "my-import"
    });
    assert.deepEqual(settings, {
      lang: "de",
      voice: "Anna",
      device: "webgpu",
      temperature: 0.75,
      durationDelta: -0.25,
      modelName: "my-import"
    });
  });

  test("trims the imported model name and defaults it to empty", () => {
    assert.equal(normalizeSettings({ modelName: "  my model " }).modelName, "my model");
    assert.equal(normalizeSettings({ modelName: 4 }).modelName, "");
  });

  test("falls back on unknown languages and devices", () => {
    assert.equal(normalizeSettings({ lang: "it" }).lang, "en");
    assert.equal(normalizeSettings({ lang: "none" }).lang, "none");
    assert.equal(normalizeSettings({ device: "gpu" }).device, "cpu");
    assert.equal(normalizeSettings({ device: "auto" }).device, "cpu", "the old default becomes the CPU");
  });

  test("clamps temperature instead of failing on nonsense", () => {
    assert.equal(normalizeSettings({ temperature: 99 }).temperature, 2);
    assert.equal(normalizeSettings({ temperature: -5 }).temperature, 0);
    assert.equal(normalizeSettings({ temperature: "hot" }).temperature, DEFAULTS.temperature);
    assert.equal(normalizeSettings({ temperature: null }).temperature, DEFAULTS.temperature);
  });

  test("keeps the speaking rate within the model's useful range", () => {
    assert.equal(normalizeSettings({}).durationDelta, 0);
    assert.equal(normalizeSettings({ durationDelta: -0.3 }).durationDelta, -0.3);
    assert.equal(normalizeSettings({ durationDelta: 99 }).durationDelta, 0.5);
    assert.equal(normalizeSettings({ durationDelta: -99 }).durationDelta, -0.5);
    assert.equal(normalizeSettings({ durationDelta: "fast" }).durationDelta, 0);
    assert.equal(normalizeSettings({ durationDelta: null }).durationDelta, 0);
  });

  test("ignores blank voices and non-string ones", () => {
    assert.equal(normalizeSettings({ voice: "  " }).voice, "default");
    assert.equal(normalizeSettings({ voice: 7 }).voice, "default");
  });
});

describe("readSettings", () => {
  test("reads the settings key and normalizes it", async () => {
    const api = {
      storage: {
        local: {
          async get(key) {
            assert.equal(key, "settings");
            return { settings: { lang: "pt", temperature: 1, modelName: "m" } };
          }
        }
      }
    };
    assert.deepEqual(await readSettings(api), {
      ...DEFAULTS,
      lang: "pt",
      temperature: 1,
      modelName: "m"
    });
  });

  test("copes with an empty store", async () => {
    const api = { storage: { local: { async get() { return undefined; } } } };
    assert.deepEqual(await readSettings(api), DEFAULTS);
  });
});
