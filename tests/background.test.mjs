import { test, beforeEach, afterEach, describe } from "node:test";
import assert from "node:assert/strict";

import { setEngineLoader, resetEngineLoader } from "../src/engine.js";
import { store } from "../src/store.js";
import {
  flush,
  installAudioStub,
  loadBackground,
  makeBrowser,
  makeEngine,
  trackTimers
} from "./helpers.mjs";

function pcm(length, value = 0.25) {
  return new Float32Array(length).fill(value);
}

function record(name = "test-model") {
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

describe("background.js", () => {
  let browser;
  let audio;
  let timers;
  let created;
  let revoked;
  const realGetModel = store.getModel;
  const realCreateObjectURL = URL.createObjectURL;
  const realRevokeObjectURL = URL.revokeObjectURL;

  beforeEach(() => {
    browser = makeBrowser();
    globalThis.browser = browser;
    audio = installAudioStub();
    timers = trackTimers();
    resetEngineLoader();

    store.getModel = async (name) => record(name);
    browser.storage.local.seed("settings", { modelName: "test-model" });

    created = [];
    revoked = [];
    URL.createObjectURL = (blob) => {
      created.push(blob);
      return `blob:test/${created.length}`;
    };
    URL.revokeObjectURL = (url) => revoked.push(url);
  });

  afterEach(() => {
    timers.clearLive();
    timers.uninstall();
    resetEngineLoader();
    store.getModel = realGetModel;
    URL.createObjectURL = realCreateObjectURL;
    URL.revokeObjectURL = realRevokeObjectURL;
    delete globalThis.browser;
    delete globalThis.AudioContext;
  });

  function speakViaMenu(text = "hello world") {
    const handler = browser.__registry.contextMenuClick;
    assert.ok(handler, "context menu listener should be registered");
    handler({ menuItemId: "phonon-speak", selectionText: text });
  }

  function stopViaMenu() {
    browser.__registry.contextMenuClick({ menuItemId: "phonon-stop" });
  }

  function lastBadgeText() {
    const texts = browser.__calls.filter((call) => call.method === "action.setBadgeText");
    return texts.length ? texts[texts.length - 1].args.text : null;
  }

  function badges() {
    return browser.__calls.filter((call) => call.method === "action.setBadgeText").map((call) => call.args.text);
  }

  function send(message) {
    const listener = browser.__registry.message;
    assert.ok(listener, "message listener should be registered");
    return new Promise((resolve) => {
      const returned = listener(message, {}, resolve);
      assert.equal(returned, true, "the listener answers asynchronously");
    });
  }

  test("installing the extension creates the two menu entries", async () => {
    await loadBackground();
    await browser.__registry.installed.values().next().value();
    await flush();

    assert.deepEqual(
      browser.__registry.menuItems.map((item) => item.id),
      ["phonon-speak", "phonon-stop"]
    );
    assert.deepEqual(browser.__registry.menuItems[0].contexts, ["selection"]);
  });

  test("speaking loads the imported checkpoint with the saved settings", async () => {
    browser.storage.local.seed("settings", {
      lang: "fr",
      voice: "Anna",
      device: "cpu",
      temperature: 0.6,
      modelName: "test-model"
    });
    const loader = makeEngine({ chunks: [pcm(240)] });
    setEngineLoader(loader);

    await loadBackground();
    speakViaMenu("bonjour le monde");
    await flush();

    assert.equal(loader.options.lang, "fr");
    assert.equal(loader.options.quant, "q8");
    assert.equal(loader.options.device, "cpu");
    assert.equal(loader.options.cache, false);
    assert.match(loader.options.model.config, /^blob:test\//);
    assert.match(loader.options.model.weights.q8, /^blob:test\//);
    assert.equal(loader.options.model.defaultVoice, "Anna");
    assert.deepEqual(Object.keys(loader.options.model.voices), ["default", "Anna"]);

    const call = loader.engine.calls[0];
    assert.equal(call.text, "bonjour le monde");
    assert.equal(call.options.voice, "Anna");
    assert.equal(call.options.temperature, 0.6);
    assert.ok(call.options.signal, "generation gets an abort signal");

    const context = audio.contexts[0];
    assert.ok(context, "an AudioContext is opened");
    assert.equal(context.sampleRate, 24000);
    assert.equal(context.sources.length, 1, "the chunk is scheduled once the stream ends");
  });

  test("the toolbar badge follows load progress and playback", async () => {
    const loader = makeEngine({
      chunks: [pcm(240)],
      progress: { file: "weights", loaded: 5, total: 10, cached: false }
    });
    setEngineLoader(loader);

    await loadBackground();
    speakViaMenu("hello");
    await flush();

    assert.ok(badges().includes("50%"), `expected a 50% badge, got ${badges().join(", ")}`);
    assert.equal(lastBadgeText(), "■", "playing shows the stop square");
    const status = browser.__registry.messages.filter((m) => m.type === "status").map((m) => m.text);
    assert.ok(status.some((text) => text.startsWith("Loading weights 50%")));
  });

  test("playback ending returns the badge to idle and stops the keep-alive", async () => {
    setEngineLoader(makeEngine({ chunks: [pcm(240)] }));

    await loadBackground();
    speakViaMenu("hello");
    await flush();

    const source = audio.contexts[0].sources[0];
    assert.ok(source.started);
    source.onended();
    await flush();

    assert.equal(lastBadgeText(), "");
    assert.equal(timers.live.size, 0, "the keep-alive ping should be cleared");
  });

  test("a model that fails to load reports the error instead of hanging", async () => {
    setEngineLoader(makeEngine({ fail: new Error("model.q8.gguf: HTTP 404") }));

    await loadBackground();
    speakViaMenu("hello");
    await flush();

    assert.equal(lastBadgeText(), "!");
    assert.equal(timers.live.size, 0, "the keep-alive must not outlive the failed session");
    const status = browser.__registry.messages.filter((m) => m.type === "status").at(-1);
    assert.match(status.text, /model\.q8\.gguf: HTTP 404/);

    const state = await send({ type: "get-state" });
    assert.match(state.error, /HTTP 404/);
    assert.equal(state.active, false);
  });

  test("stop cancels generation, silences audio and clears the keep-alive", async () => {
    setEngineLoader(makeEngine({ chunks: [pcm(7200)], wait: true }));

    await loadBackground();
    speakViaMenu("a long sentence");
    await flush();

    const context = audio.contexts[0];
    assert.equal(context.sources.length, 1, "the first chunk reached the player");

    stopViaMenu();
    await flush();

    assert.equal(context.closed, true);
    assert.ok(context.sources.every((source) => source.stopped));
    assert.equal(lastBadgeText(), "");
    assert.equal(timers.live.size, 0);
    const state = await send({ type: "get-state" });
    assert.equal(state.active, false);
  });

  test("the model is loaded once and reused for the next selection", async () => {
    const loader = makeEngine({ chunks: [pcm(240)] });
    setEngineLoader(loader);

    await loadBackground();
    speakViaMenu("first");
    await flush();
    audio.contexts[0].sources[0].onended();
    await flush();

    speakViaMenu("second");
    await flush();

    assert.equal(loader.engine.calls.length, 2);
    audio.contexts[1].sources[0].onended();
    await flush();
    assert.equal(timers.live.size, 0, "the second session finished too");
  });

  test("changing the language disposes the old engine before loading again", async () => {
    const loader = makeEngine({ chunks: [pcm(240)] });
    setEngineLoader(loader);

    await loadBackground();
    speakViaMenu("first");
    await flush();
    audio.contexts[0].sources[0].onended();
    await flush();

    await send({ type: "save-settings", settings: { lang: "de", modelName: "test-model" } });
    speakViaMenu("zweite");
    await flush();

    assert.equal(loader.engine.calls.length, 2);
    assert.equal(loader.engine.disposed, 1);
    assert.equal(loader.engine.calls[1].text, "zweite");
    audio.contexts[1].sources[0].onended();
    await flush();
  });

  test("a settings change while the model is loading wins over the loading model", async () => {
    let release;
    const gate = new Promise((resolve) => (release = resolve));
    const loader = makeEngine({ chunks: [pcm(240)], gate });
    setEngineLoader(loader);

    await loadBackground();
    speakViaMenu("first");
    await flush();
    assert.equal(loader.allOptions.length, 1, "the first load is still in flight");

    // No engine exists yet, so this cannot dispose anything; it only changes what the next
    // speaker asks for. That speaker must not be handed the English model.
    await send({ type: "save-settings", settings: { lang: "de", modelName: "test-model" } });
    speakViaMenu("zweite");
    await flush();

    release();
    await flush(12);

    assert.equal(loader.allOptions.length, 2);
    assert.equal(loader.allOptions[0].lang, "en");
    assert.equal(loader.allOptions[1].lang, "de");
    assert.equal(loader.engine.disposed, 1);
    assert.equal(loader.engine.calls.at(-1).text, "zweite");

    audio.contexts.at(-1).sources[0]?.onended();
    await flush();
  });

  test("changing the voice alone does not reload the model", async () => {
    const loader = makeEngine({ chunks: [pcm(240)] });
    setEngineLoader(loader);

    await loadBackground();
    speakViaMenu("first");
    await flush();
    audio.contexts[0].sources[0].onended();
    await flush();

    await send({ type: "save-settings", settings: { voice: "Anna", modelName: "test-model" } });
    speakViaMenu("second");
    await flush();

    assert.equal(loader.engine.disposed, 0);
    assert.equal(loader.engine.calls[1].options.voice, "Anna");
    audio.contexts[1].sources[0].onended();
    await flush();
  });

  test("the toolbar button with no selection hints instead of loading the model", async () => {
    const loader = makeEngine({ chunks: [pcm(240)] });
    setEngineLoader(loader);

    await loadBackground();
    browser.__registry.actionClick({ id: 7 });
    await flush();

    assert.equal(lastBadgeText(), "!");
    assert.equal(loader.engine?.calls.length ?? 0, 0);
    assert.equal(audio.contexts.length, 0);
  });

  test("the toolbar button speaks the page selection", async () => {
    browser.scripting.executeScript = async () => [{ result: "  from the page  " }];
    const loader = makeEngine({ chunks: [pcm(240)] });
    setEngineLoader(loader);

    await loadBackground();
    browser.__registry.actionClick({ id: 7 });
    await flush();

    assert.equal(loader.engine.calls[0].text, "from the page");
  });

  test("the toolbar button stops while audio is playing", async () => {
    setEngineLoader(makeEngine({ chunks: [pcm(7200)], wait: true }));

    await loadBackground();
    speakViaMenu("hello");
    await flush();

    browser.__registry.actionClick({ id: 7 });
    await flush();

    assert.equal(audio.contexts[0].closed, true);
    assert.equal(lastBadgeText(), "");
  });

  test("save-settings normalizes what the options page sends", async () => {
    await loadBackground();

    const state = await send({
      type: "save-settings",
      settings: { lang: "zz", device: "gpu", temperature: 99, modelName: "" }
    });

    assert.equal(state.settings.lang, "en");
    assert.equal(state.settings.device, "auto");
    assert.equal(state.settings.temperature, 2);
    assert.equal(state.settings.modelName, "");
    assert.deepEqual(browser.__storage.get("settings"), state.settings);
  });

  test("get-state describes the imported model and its voices", async () => {
    await loadBackground();
    const state = await send({ type: "get-state" });

    assert.equal(state.model.source, "imported");
    assert.equal(state.model.modelDir, "test-model");
    assert.deepEqual(state.model.voices, ["default", "Anna"]);
    assert.equal(state.model.defaultVoice, "default");
    assert.deepEqual(state.model.missing, []);
  });

  test("a fresh install says no model is imported, and speaking explains it", async () => {
    browser.storage.local.seed("settings", {});
    const loader = makeEngine({ chunks: [pcm(240)] });
    setEngineLoader(loader);

    await loadBackground();
    const before = await send({ type: "get-state" });
    assert.equal(before.model.source, "none");
    assert.deepEqual(before.model.voices, []);

    speakViaMenu("hello");
    await flush();

    assert.equal(lastBadgeText(), "!");
    const status = browser.__registry.messages.filter((m) => m.type === "status").at(-1);
    assert.match(status.text, /No model imported yet/);
    assert.equal(loader.engine.calls.length, 0);
    assert.equal(timers.live.size, 0);
  });

  test("the options page can ask for a test sentence straight away", async () => {
    const loader = makeEngine({ chunks: [pcm(240)], wait: true });
    setEngineLoader(loader);

    await loadBackground();
    const reply = await send({ type: "speak", text: "testing" });
    await flush();

    assert.deepEqual(reply, { ok: true });
    assert.equal(loader.engine.calls[0].text, "testing");

    await send({ type: "stop" });
    await flush();
    assert.equal(timers.live.size, 0);
  });

  test("switching model releases every blob URL the old one used", async () => {
    const loader = makeEngine({ chunks: [pcm(240)] });
    setEngineLoader(loader);

    await loadBackground();
    speakViaMenu("imported");
    await flush();

    assert.ok(created.length >= 4, "one URL per file");
    assert.equal(revoked.length, 0, "nothing is released while the model is loaded");

    await send({ type: "save-settings", settings: { modelName: "" } });
    assert.equal(revoked.length, created.length, "switching away releases every URL");

    audio.contexts[0].sources[0]?.onended();
    await flush();
  });

  test("a deleted imported model reports a useful error instead of silence", async () => {
    store.getModel = async () => null;

    await loadBackground();
    speakViaMenu("hello");
    await flush();

    assert.equal(lastBadgeText(), "!");
    const status = browser.__registry.messages.filter((m) => m.type === "status").at(-1);
    assert.match(status.text, /no longer in browser storage/);
    assert.equal(timers.live.size, 0);
  });
});
