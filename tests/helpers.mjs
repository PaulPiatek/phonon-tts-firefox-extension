let backgroundCounter = 0;
let optionsCounter = 0;

export async function loadBackground() {
  return import(`../src/background.js?v=${backgroundCounter++}`);
}

export async function loadOptions() {
  return import(`../src/options.js?v=${optionsCounter++}`);
}

export function flush(rounds = 6) {
  let promise = Promise.resolve();
  for (let i = 0; i < rounds; i++) {
    promise = promise.then(() => new Promise((resolve) => setImmediate(resolve)));
  }
  return promise;
}

export function makeBrowser() {
  const storageMap = new Map();
  const calls = [];
  const registry = {
    menuItems: [],
    contextMenuClick: null,
    actionClick: null,
    installed: new Set(),
    message: null,
    messages: []
  };
  const log = (method, args) => calls.push({ method, args });

  return {
    __calls: calls,
    __registry: registry,
    __storage: storageMap,
    storage: {
      local: {
        seed(key, value) {
          storageMap.set(key, value);
        },
        async get(key) {
          return storageMap.has(key) ? { [key]: storageMap.get(key) } : {};
        },
        async set(entries) {
          for (const [key, value] of Object.entries(entries)) storageMap.set(key, value);
        }
      }
    },
    action: {
      setBadgeText(args) {
        log("action.setBadgeText", args);
        return Promise.resolve();
      },
      setBadgeBackgroundColor(args) {
        log("action.setBadgeBackgroundColor", args);
        return Promise.resolve();
      },
      setTitle(args) {
        log("action.setTitle", args);
        return Promise.resolve();
      },
      onClicked: {
        addListener(fn) {
          registry.actionClick = fn;
        }
      }
    },
    contextMenus: {
      create(item) {
        registry.menuItems.push(item);
      },
      removeAll() {
        return Promise.resolve();
      },
      onClicked: {
        addListener(fn) {
          registry.contextMenuClick = fn;
        }
      }
    },
    runtime: {
      getURL(path) {
        return `moz-extension://test/${path}`;
      },
      sendMessage(message) {
        registry.messages.push(message);
        return Promise.resolve();
      },
      onMessage: {
        addListener(fn) {
          registry.message = fn;
        }
      },
      onInstalled: {
        addListener(fn) {
          registry.installed.add(fn);
        }
      },
      onConnect: {
        addListener(fn) {
          registry.connected ??= new Set();
          registry.connected.add(fn);
        }
      },
      getPlatformInfo() {
        log("runtime.getPlatformInfo");
        return Promise.resolve({ os: "test", arch: "x86" });
      }
    },
    scripting: {
      async executeScript() {
        return [{ result: "" }];
      }
    }
  };
}

export function installAudioStub() {
  const audio = { contexts: [] };

  class FakeAudioContext {
    constructor(options = {}) {
      this.sampleRate = options.sampleRate ?? 48000;
      this.currentTime = 0;
      this.destination = {};
      this.resumed = false;
      this.closed = false;
      this.buffers = [];
      this.sources = [];
      audio.contexts.push(this);
    }

    resume() {
      this.resumed = true;
      return Promise.resolve();
    }

    close() {
      this.closed = true;
      return Promise.resolve();
    }

    createBuffer(channelCount, length, sampleRate) {
      const data = new Float32Array(length);
      const buffer = {
        length,
        sampleRate,
        duration: length / sampleRate,
        getChannelData() {
          return data;
        }
      };
      this.buffers.push(buffer);
      return buffer;
    }

    createBufferSource() {
      const source = {
        buffer: null,
        started: false,
        stopped: false,
        startTime: null,
        onended: null
      };
      source.connect = () => {};
      source.start = (time) => {
        source.started = true;
        source.startTime = time;
      };
      source.stop = () => {
        source.stopped = true;
      };
      this.sources.push(source);
      return source;
    }
  }

  globalThis.AudioContext = FakeAudioContext;
  return audio;
}

const realSetInterval = globalThis.setInterval;
const realClearInterval = globalThis.clearInterval;
const realSetTimeout = globalThis.setTimeout;
const realClearTimeout = globalThis.clearTimeout;

export function trackTimers() {
  const live = new Set();

  globalThis.setInterval = (fn, ms, ...args) => {
    const id = realSetInterval(fn, ms, ...args);
    live.add(id);
    return id;
  };
  globalThis.clearInterval = (id) => {
    live.delete(id);
    return realClearInterval(id);
  };
  globalThis.setTimeout = (fn, ms, ...args) => {
    const id = realSetTimeout(fn, ms, ...args);
    live.add(id);
    return id;
  };
  globalThis.clearTimeout = (id) => {
    live.delete(id);
    return realClearTimeout(id);
  };

  return {
    live,
    clearLive() {
      for (const id of [...live]) {
        live.delete(id);
        realClearInterval(id);
        realClearTimeout(id);
      }
    },
    uninstall() {
      globalThis.setInterval = realSetInterval;
      globalThis.clearInterval = realClearInterval;
      globalThis.setTimeout = realSetTimeout;
      globalThis.clearTimeout = realClearTimeout;
    }
  };
}

export function installFetch(handler) {
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return handler(url, options);
  };
  return calls;
}

export function jsonResponse(body) {
  return {
    ok: true,
    status: 200,
    async json() {
      return body;
    },
    async text() {
      return JSON.stringify(body);
    }
  };
}

/** A stream the fake engine returns: yields `chunks`, then optionally waits for abort. */
export function fakeStream(chunks, { signal, wait = false, onDone } = {}) {
  return {
    done: Promise.resolve({ cancelled: false }),
    cancel() {},
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) {
        if (signal?.aborted) return;
        yield chunk;
      }
      while (wait && !signal?.aborted) {
        await new Promise((resolve) => realSetTimeout(resolve, 5));
      }
      onDone?.();
    }
  };
}

/**
 * Replace the phonon runtime with a fake. `chunks` is what `stream()` yields; `wait` keeps
 * the stream open until the caller aborts, so stop tests have something to interrupt.
 */
export function makeEngine({ chunks = [], wait = false, fail = null, progress = null, gate = null } = {}) {
  const calls = [];
  const engine = {
    device: "cpu",
    deviceReason: "test",
    threads: 1,
    threadsReason: "test",
    sampleRate: 24000,
    languages: ["en", "fr", "de", "es", "pt"],
    voices: ["default", "Anna"],
    disposed: 0,
    calls,
    stream(text, options = {}) {
      calls.push({ text, options });
      return fakeStream(chunks, { signal: options.signal, wait });
    },
    dispose() {
      engine.disposed += 1;
    }
  };

  const loader = async (options) => {
    loader.options = options;
    loader.allOptions = [...(loader.allOptions ?? []), options];
    if (progress) options.onProgress?.(progress);
    if (gate) await gate;
    if (fail) throw fail;
    return engine;
  };
  loader.engine = engine;
  return loader;
}
