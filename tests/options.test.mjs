// The options page's rendering, exercised against a minimal DOM. This is what catches a
// row that prints a class name instead of its content, or a setting that does not save.

import { test, beforeEach, afterEach, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

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

  fire(type) {
    for (const handler of this.listeners.get(type) ?? []) handler({ preventDefault() {}, type });
  }

  closest() {
    return null;
  }
}

function flatten(node) {
  return [node, ...node.children.flatMap((child) => (child instanceof FakeText ? [] : flatten(child)))];
}

function byId(elements) {
  return (id) => elements.get(id);
}

describe("options page", () => {
  let elements;
  let messages;

  beforeEach(() => {
    elements = new Map();
    messages = [];
    const html = readFileSync(new URL("../src/options.html", import.meta.url), "utf8");
    for (const [, id] of html.matchAll(/id="([^"]+)"/g)) elements.set(id, new FakeNode("div"));

    globalThis.document = {
      createElement: (tag) => new FakeNode(tag),
      createTextNode: (text) => new FakeText(text),
      getElementById: byId(elements)
    };

    const settings = {
      lang: "en",
      voice: "default",
      device: "auto",
      temperature: 0.3,
      modelName: "test-model"
    };
    const state = {
      settings,
      status: { text: "Idle", badge: "", ok: false },
      error: null,
      active: false,
      engine: null,
      model: {
        source: "imported",
        modelDir: "test-model",
        voices: ["default", "Henrik"],
        modelVoices: ["default"],
        defaultVoice: "default",
        missing: [],
        library: [
          {
            name: "Henrik",
            bytes: 256136,
            language: "de",
            description: "Warm, low and unhurried.",
            shadowed: false
          }
        ]
      }
    };

    globalThis.browser = {
      runtime: {
        sendMessage: async (message) => {
          messages.push(message);
          if (message.type === "save-settings") {
            Object.assign(state.settings, message.settings);
            return { ...state, settings: { ...state.settings } };
          }
          if (message.type === "voices-changed") return { ...state, settings: { ...state.settings } };
          return { ...state, settings: { ...state.settings } };
        },
        onMessage: { addListener() {} }
      }
    };
  });

  afterEach(() => {
    delete globalThis.document;
    delete globalThis.browser;
  });

  async function load() {
    await import(`../src/options.js?v=${Date.now()}`);
    // `refresh()` is started at module load; give its promises room to settle.
    for (let i = 0; i < 10; i++) await new Promise((resolve) => setImmediate(resolve));
  }

  test("voice rows show the language and description as content, not class names", async () => {
    await load();
    const list = elements.get("voice-list");
    const nodes = flatten(list);

    const meta = nodes.find((node) => node.className === "voice-meta");
    assert.ok(meta, "a .voice-meta node should exist");
    assert.equal(meta.textContent, "de");

    const description = nodes.find((node) => node.className === "voice-desc");
    assert.ok(description, "a .voice-desc node should exist");
    assert.equal(description.textContent, "Warm, low and unhurried.");

    const stray = nodes.filter((node) => node.className === "" && (node.textContent === "voice-meta" || node.textContent === "voice-desc"));
    assert.deepEqual(stray, [], "class names must not be printed as text");

    assert.match(list.textContent, /Henrik/);
    assert.match(list.textContent, /Warm, low and unhurried/);
  });

  test("changing a setting saves it without pressing anything", async () => {
    await load();
    messages.length = 0;

    const language = elements.get("lang");
    language.value = "de";
    language.fire("change");
    for (let i = 0; i < 6; i++) await new Promise((resolve) => setImmediate(resolve));

    const saves = messages.filter((message) => message.type === "save-settings");
    assert.equal(saves.length, 1, "the change triggers one save");
    assert.equal(saves[0].settings.lang, "de");

    const voice = elements.get("voice");
    voice.value = "Henrik";
    voice.fire("change");
    for (let i = 0; i < 6; i++) await new Promise((resolve) => setImmediate(resolve));

    const last = messages.filter((message) => message.type === "save-settings").at(-1);
    assert.equal(last.settings.voice, "Henrik");
  });
});
