// The options page's rendering, exercised against a minimal DOM. This is what catches a
// row that prints a class name instead of its content, a model that is imported but never
// selected, or a setting that does not save.

import { test, beforeEach, afterEach, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { store } from "../src/store.js";

class FakeText {
  constructor(text) {
    this._text = String(text);
  }
  get textContent() {
    return this._text;
  }
}

class FakeNode {
  constructor(tagName = "div") {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.listeners = new Map();
    this._text = "";
    this.className = "";
    this.id = "";
    this.value = "";
    this.files = [];
    this.disabled = false;
    this.type = "";
    this.title = "";
    this.classList = {
      add: (name) => {
        if (!this.className.split(" ").includes(name)) this.className = `${this.className} ${name}`.trim();
      },
      remove: (name) => {
        this.className = this.className.split(" ").filter((part) => part && part !== name).join(" ");
      },
      toggle: (name, force) => {
        if (force === undefined ? !this.classList.contains(name) : force) this.classList.add(name);
        else this.classList.remove(name);
      },
      contains: (name) => this.className.split(" ").includes(name)
    };
  }

  set textContent(value) {
    this._text = String(value);
    this.children = [];
  }

  get textContent() {
    if (this.children.length === 0) return this._text;
    return this.children.map((child) => child.textContent).join("");
  }

  append(...nodes) {
    for (const node of nodes) this.children.push(typeof node === "string" ? new FakeText(node) : node);
  }

  replaceChildren(...nodes) {
    this.children = [];
    this._text = "";
    this.append(...nodes);
  }

  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(handler);
  }

  fire(type, event = {}) {
    for (const handler of this.listeners.get(type) ?? []) {
      handler({ preventDefault() {}, type, ...event });
    }
  }

  closest() {
    return null;
  }
}

function flatten(node) {
  return [node, ...node.children.flatMap((child) => (child instanceof FakeText ? [] : flatten(child)))];
}

function fakeFile(path, text) {
  const blob = new Blob([text]);
  return {
    name: path.split("/").pop(),
    size: blob.size,
    webkitRelativePath: path,
    text: () => blob.text(),
    slice: (start, end) => blob.slice(start, end)
  };
}

const sleep = (rounds = 12) => {
  let promise = Promise.resolve();
  for (let i = 0; i < rounds; i++) promise = promise.then(() => new Promise((resolve) => setImmediate(resolve)));
  return promise;
};

describe("options page", () => {
  let elements;
  let messages;
  let models;
  let state;
  const realStore = {
    listModels: store.listModels,
    putModel: store.putModel,
    deleteModel: store.deleteModel,
    putVoices: store.putVoices,
    deleteVoice: store.deleteVoice
  };

  beforeEach(() => {
    elements = new Map();
    messages = [];
    models = [
      { name: "phonon-40m-multilingual", bytes: 75 * 1024 * 1024 },
      { name: "phonon-31m-en", bytes: 64 * 1024 * 1024 }
    ];

    const html = readFileSync(new URL("../src/options.html", import.meta.url), "utf8");
    for (const [, id] of html.matchAll(/id="([^"]+)"/g)) elements.set(id, new FakeNode("div"));

    globalThis.document = {
      createElement: (tag) => new FakeNode(tag),
      createTextNode: (text) => new FakeText(text),
      getElementById: (id) => elements.get(id)
    };

    const settings = {
      lang: "en",
      voice: "default",
      device: "auto",
      temperature: 0.3,
      durationDelta: 0,
      modelName: "phonon-40m-multilingual"
    };
    state = {
      settings,
      status: { text: "Idle", badge: "", ok: false },
      error: null,
      active: false,
      engine: null,
      model: {
        source: "imported",
        modelDir: "phonon-40m-multilingual",
        voices: ["default", "Henrik", "Zoey"],
        modelVoices: ["default"],
        languages: ["en", "fr", "de", "es", "pt"],
        defaultVoice: "default",
        missing: [],
        library: [
          {
            name: "Henrik",
            bytes: 256136,
            language: "de",
            description: "Warm, low and unhurried.",
            shadowed: false
          },
          {
            name: "Zoey",
            bytes: 256136,
            language: "en",
            description: "Bright and playful.",
            shadowed: false
          }
        ]
      }
    };

    store.listModels = async () => models.map((model) => ({ ...model }));
    store.putModel = async (record) => {
      models = [...models.filter((model) => model.name !== record.name), { name: record.name, bytes: record.bytes }];
    };
    store.deleteModel = async (name) => {
      models = models.filter((model) => model.name !== name);
    };
    store.putVoices = async () => {};
    store.deleteVoice = async () => {};

    globalThis.browser = {
      runtime: {
        sendMessage: async (message) => {
          messages.push(message);
          if (message.type === "save-settings") {
            Object.assign(state.settings, message.settings);
            state.model.modelDir = state.settings.modelName || "";
          }
          return { ...state, settings: { ...state.settings }, model: { ...state.model } };
        },
        onMessage: { addListener() {} }
      }
    };
  });

  afterEach(() => {
    Object.assign(store, realStore);
    delete globalThis.document;
    delete globalThis.browser;
  });

  async function load() {
    await import(`../src/options.js?v=${Date.now()}`);
    await sleep();
  }

  test("voice rows show the language and description as content, not class names", async () => {
    await load();
    const nodes = flatten(elements.get("voice-list"));

    const meta = nodes.find((node) => node.className === "voice-meta");
    assert.ok(meta, "a .voice-meta node should exist");
    assert.equal(meta.textContent, "de");

    const description = nodes.find((node) => node.className === "voice-desc");
    assert.ok(description, "a .voice-desc node should exist");
    assert.equal(description.textContent, "Warm, low and unhurried.");

    const stray = nodes.filter(
      (node) => node.className === "" && (node.textContent === "voice-meta" || node.textContent === "voice-desc")
    );
    assert.deepEqual(stray, [], "class names must not be printed as text");
  });

  test("changing a setting saves it without pressing anything", async () => {
    await load();
    messages.length = 0;

    const language = elements.get("lang");
    language.value = "de";
    language.fire("change");
    await sleep();

    const saves = messages.filter((message) => message.type === "save-settings");
    assert.equal(saves.length, 1, "the change triggers one save");
    assert.equal(saves[0].settings.lang, "de");

    const voice = elements.get("voice");
    voice.value = "Henrik";
    voice.fire("change");
    await sleep();

    const last = messages.filter((message) => message.type === "save-settings").at(-1);
    assert.equal(last.settings.voice, "Henrik");

    const rate = elements.get("rate");
    rate.value = "-0.3";
    rate.fire("input");
    assert.equal(elements.get("rate-value").textContent, "-0.30");
    rate.fire("change");
    await sleep();

    const lastRate = messages.filter((message) => message.type === "save-settings").at(-1);
    assert.equal(lastRate.settings.durationDelta, -0.3);
  });

  test("the voice search filters by name, language or description", async () => {
    await load();
    const search = elements.get("voiceSearch");
    const list = elements.get("voice-list");

    search.value = "hen";
    search.fire("input");
    assert.match(list.textContent, /Henrik/);
    assert.doesNotMatch(list.textContent, /Zoey/);

    search.value = "bright";
    search.fire("input");
    assert.match(list.textContent, /Zoey/);
    assert.doesNotMatch(list.textContent, /Henrik/);

    search.value = "de";
    search.fire("input");
    assert.match(list.textContent, /Henrik/, "language matches too");
    assert.doesNotMatch(list.textContent, /Zoey/);

    search.value = "no-such-voice";
    search.fire("input");
    assert.match(list.textContent, /No voices match the search/);
  });

  test("importing a model selects and saves it, ready to speak", async () => {
    await load();
    elements.get("modelPicker").files = [
      fakeFile("phonon-40m-de/config.json", JSON.stringify({ languages: ["de"] })),
      fakeFile("phonon-40m-de/tokenizer.json", "{}"),
      fakeFile("phonon-40m-de/model.q8.gguf", "gguf"),
      fakeFile("phonon-40m-de/default-voice.safetensors", "voice")
    ];
    elements.get("modelPicker").fire("change");
    await sleep(30);

    assert.equal(elements.get("modelName").value, "phonon-40m-de");
    const last = messages.filter((message) => message.type === "save-settings").at(-1);
    assert.equal(last.settings.modelName, "phonon-40m-de");
    assert.match(elements.get("model-info").textContent, /phonon-40m-de/);
  });

  test("warns when the text language is not one the model was trained for", async () => {
    await load();
    state.model.languages = ["en"];

    const language = elements.get("lang");
    language.value = "de";
    language.fire("change");
    await sleep();

    const warning = elements.get("lang-warning");
    assert.equal(warning.classList.contains("hidden"), false);
    assert.match(warning.textContent, /trained for en/);
    assert.match(warning.textContent, /German/);
  });
});
