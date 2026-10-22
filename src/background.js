// The background event page: menus, the toolbar toggle, the model, and playback.
//
// Everything runs here, in the extension's own process, with no server and no network.
// Firefox terminates an idle MV3 event page after a few seconds, which is why a ping
// keeps it alive while the model is loading or audio is still playing. Once it does go,
// the next click loads the checkpoint again, which is why progress is on the badge.

import { normalizeSettings, readSettings } from "./settings.js";
import { buildSpec, describeModel } from "./model.js";
import { store } from "./store.js";
import { Player } from "./player.js";
import { loadEngine } from "./engine.js";

const SPEAK_MENU_ID = "spokra-speak";
const STOP_MENU_ID = "spokra-stop";
const SETTINGS_MENU_ID = "spokra-settings";
const KEEP_ALIVE_MS = 15000;
const HINT_CLEAR_MS = 2000;
const TEST_TEXT = {
  en: "Hello. Spokra is running inside your browser, with no server.",
  fr: "Bonjour. Spokra fonctionne dans votre navigateur, sans serveur.",
  de: "Hallo. Spokra läuft in Ihrem Browser, ohne Server.",
  es: "Hola. Spokra se ejecuta en tu navegador, sin servidor.",
  pt: "Olá. O Spokra está a ser executado no seu navegador, sem servidor.",
  none: "Hello. Spokra is running inside your browser, with no server."
};

const api = globalThis.browser ?? globalThis.chrome;

const state = {
  engine: null,
  engineInfo: null,
  engineSettings: null,
  enginePromise: null,
  // blob: URLs for an imported checkpoint, alive only as long as the engine that uses them.
  blobUrls: [],
  session: null,
  sessionId: 0,
  status: { text: "Idle", badge: "", ok: false },
  error: null
};

// ---------------------------------------------------------------- status and keeping awake

function updateBadge() {
  api.action.setBadgeBackgroundColor({ color: state.status.badge ? "#b00020" : "#888888" }).catch(() => {});
  api.action.setBadgeText({ text: state.status.badge }).catch(() => {});
  api.action
    .setTitle({
      title: state.session ? "Spokra: click to stop" : "Spokra: click to speak selection"
    })
    .catch(() => {});
}

let hintClearTimer = null;

function cancelHintClear() {
  if (!hintClearTimer) return;
  clearTimeout(hintClearTimer);
  hintClearTimer = null;
}

/** Show the "nothing selected" hint on the badge, then let it go away by itself. */
function hintEmptySelection() {
  setStatus("Select some text first", "!");
  hintClearTimer = setTimeout(() => {
    hintClearTimer = null;
    if (state.status.badge === "!") setStatus("Idle");
  }, HINT_CLEAR_MS);
}

function setStatus(text, badge = "", ok = false) {
  cancelHintClear();
  state.status = { text, badge, ok };
  updateBadge();
  // Extension pages listening for live status (the options page) get it directly; there
  // is no such page when the toolbar button is all that is used, and that is fine.
  try {
    Promise.resolve(
      api.runtime.sendMessage({ type: "status", ...state.status, active: Boolean(state.session) })
    ).catch(() => {});
  } catch {
    // No receiver, which is the normal case.
  }
}

let keepAliveTimer = null;

function startKeepAlive() {
  if (keepAliveTimer) return;
  keepAliveTimer = setInterval(() => {
    api.runtime.getPlatformInfo().catch(() => {});
  }, KEEP_ALIVE_MS);
}

function stopKeepAlive() {
  if (!keepAliveTimer) return;
  clearInterval(keepAliveTimer);
  keepAliveTimer = null;
}

/** Keep the page awake while a load is in flight or a session is running. */
function updateKeepAlive() {
  if (state.session || state.enginePromise) startKeepAlive();
  else stopKeepAlive();
}

// ---------------------------------------------------------------- the model

function disposeEngine() {
  if (state.engine) {
    try {
      state.engine.dispose();
    } catch {
      // A worker that already died has nothing left to free.
    }
  }
  for (const url of state.blobUrls) {
    try {
      URL.revokeObjectURL(url);
    } catch {
      // Already gone.
    }
  }
  state.blobUrls = [];
  state.engine = null;
  state.engineInfo = null;
  state.engineSettings = null;
}

function needsReload(settings) {
  if (!state.engine || !state.engineSettings) return false;
  return (
    state.engineSettings.lang !== settings.lang ||
    state.engineSettings.modelName !== settings.modelName ||
    state.engineSettings.device !== settings.device ||
    state.engineSettings.durationDelta !== settings.durationDelta
  );
}

function progressReporter() {
  // A 75 MB file arrives in thousands of chunks; the badge and the options page only need a
  // handful of updates a second.
  let lastAt = 0;
  return ({ file, loaded, total, cached }) => {
    const now = Date.now();
    if (!cached && now - lastAt < 150) return;
    lastAt = now;

    const percent = total ? Math.min(99, Math.round((loaded / total) * 100)) : null;
    const label = file?.startsWith("voice:") ? "voice" : file || "model";
    const detail = percent === null
      ? `${label} ${Math.round(loaded / 1024 / 1024)} MB`
      : `${label} ${percent}%`;
    setStatus(`Loading ${detail}${cached ? " (cached)" : ""}`, percent === null ? "…" : `${percent}%`, true);
  };
}

async function getEngine(settings) {
  if (needsReload(settings)) disposeEngine();
  if (state.engine) return state.engine;

  // A load already in flight cannot be cancelled, but it may have been started with other
  // settings: wait for it, then reload if it ended up speaking a different language.
  if (state.enginePromise) {
    await state.enginePromise.catch(() => {});
    if (needsReload(settings)) {
      disposeEngine();
      return getEngine(settings);
    }
    if (state.engine) return state.engine;
  }

  const loading = (async () => {
    const model = await describeModel({ settings, store });
    setStatus("Loading model…", "…", true);
    const { spec, blobUrls } = buildSpec(model);
    state.blobUrls = blobUrls;

    let engine;
    try {
      engine = await loadEngine({ settings, spec, onProgress: progressReporter() });
    } catch (error) {
      // Nothing will use these now; the next attempt makes its own.
      for (const url of blobUrls) URL.revokeObjectURL(url);
      if (state.blobUrls === blobUrls) state.blobUrls = [];
      throw error;
    }

    state.engine = engine;
    state.engineSettings = settings;
    state.engineInfo = {
      device: engine.device,
      deviceReason: engine.deviceReason,
      features: engine.features,
      threads: engine.threads,
      threadsReason: engine.threadsReason,
      sampleRate: engine.sampleRate,
      languages: engine.languages,
      voices: engine.voices
    };
    return engine;
  })();

  state.enginePromise = loading;
  updateKeepAlive();
  try {
    return await loading;
  } finally {
    if (state.enginePromise === loading) state.enginePromise = null;
    updateKeepAlive();
  }
}

// ---------------------------------------------------------------- speaking

function endSession() {
  const session = state.session;
  state.session = null;
  if (session) {
    session.controller.abort();
    session.player.stop();
  }
  updateKeepAlive();
  return session;
}

function stop(reason = "Stopped") {
  const session = endSession();
  if (session) {
    state.error = null;
    setStatus(reason);
  }
}

function fail(error) {
  const message = error instanceof Error ? error.message : String(error);
  state.error = message;
  endSession();
  setStatus("Error: " + message, "!");
}

async function speak(text, voiceOverride) {
  const clean = (text || "").trim();
  if (!clean) {
    hintEmptySelection();
    return;
  }
  stop();
  state.error = null;

  const id = ++state.sessionId;
  const controller = new AbortController();
  const player = new Player({
    onIdle: () => {
      if (state.session?.id !== id) return;
      state.session = null;
      updateKeepAlive();
      setStatus("Done");
    }
  });
  state.session = { id, controller, player };
  updateKeepAlive();

  // Opened here, inside the click that asked for speech, rather than after the model has
  // loaded: a context created seconds later, outside the user gesture, can stay suspended.
  try {
    player.start();
  } catch (error) {
    fail(error);
    return;
  }
  setStatus("Loading model…", "…", true);

  const settings = await readSettings(api).catch((error) => {
    fail(error);
    return null;
  });
  if (!settings || state.session?.id !== id) return;

  let engine;
  try {
    engine = await getEngine(settings);
  } catch (error) {
    if (state.session?.id === id) fail(error);
    return;
  }
  if (state.session?.id !== id) return;

  const wanted = voiceOverride || settings.voice;

  // Belt and braces: the voice library can change while the engine is loaded. If the wanted
  // voice exists in storage but not in this engine's spec, rebuild before speaking, so a new
  // voice never silently falls back to the default one.
  if (wanted && !engine.voices?.includes(wanted)) {
    const stored = await store.getVoice(wanted).catch(() => null);
    if (stored?.blob) {
      disposeEngine();
      engine = await getEngine(settings);
      if (state.session?.id !== id) return;
    }
  }

  const voice = engine.voices?.includes(wanted) ? wanted : undefined;
  setStatus("Speaking…", "■", true);
  try {
    for await (const pcm of engine.stream(clean, {
      voice,
      temperature: settings.temperature,
      signal: controller.signal
    })) {
      if (state.session?.id !== id) return;
      player.push(pcm);
    }
    if (state.session?.id !== id) return;
    player.finish();
    if (state.session?.id === id) setStatus("Playing…", "■", true);
  } catch (error) {
    if (controller.signal.aborted || state.session?.id !== id) return;
    fail(error);
  }
}

// ---------------------------------------------------------------- menus and toolbar

function installMenus() {
  api.contextMenus.removeAll().finally(() => {
    api.contextMenus.create({ id: SPEAK_MENU_ID, title: "🔊 Spokra", contexts: ["selection"] });
    api.contextMenus.create({ id: STOP_MENU_ID, title: "🔇 Stop Spokra", contexts: ["all"] });
    try {
      api.contextMenus.create({
        id: SETTINGS_MENU_ID,
        title: "Spokra Settings…",
        contexts: ["action"]
      });
    } catch {
      // Firefox for Android has no toolbar button to right-click.
    }
  });
}

api.runtime.onInstalled.addListener(installMenus);

async function getSelectedText(tabId) {
  if (tabId === undefined) return "";
  try {
    const [injection] = await api.scripting.executeScript({
      target: { tabId },
      func: () => window.getSelection()?.toString() || ""
    });
    return (injection?.result || "").trim();
  } catch {
    return "";
  }
}

api.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId === SPEAK_MENU_ID) {
    speak(info.selectionText || "").catch((error) => fail(error));
    return;
  }
  if (info.menuItemId === STOP_MENU_ID) stop();
  if (info.menuItemId === SETTINGS_MENU_ID) {
    api.runtime.openOptionsPage().catch((error) => fail(error));
  }
});

api.action.onClicked.addListener(async (tab) => {
  if (state.session) {
    stop();
    return;
  }
  const text = await getSelectedText(tab?.id);
  if (!text) {
    hintEmptySelection();
    return;
  }
  speak(text).catch((error) => fail(error));
});

// ---------------------------------------------------------------- options page

async function describeState() {
  const settings = await readSettings(api);
  let model;
  let missing = [];
  try {
    model = await describeModel({ settings, store });
  } catch (error) {
    // An imported model can be deleted, or its storage cleared, between visits.
    model = {
      source: "imported",
      modelDir: settings.modelName,
      voices: [],
      modelVoices: [],
      languages: [],
      library: [],
      defaultVoice: null
    };
    missing = [error instanceof Error ? error.message : String(error)];
  }
  return {
    settings,
    status: state.status,
    error: state.error,
    active: Boolean(state.session),
    model: {
      source: model.source,
      modelDir: model.modelDir,
      voices: model.voices,
      modelVoices: model.modelVoices ?? [],
      languages: model.languages ?? [],
      library: (model.library ?? []).map((voice) => ({
        name: voice.name,
        bytes: voice.bytes ?? voice.blob?.size ?? 0,
        language: voice.language,
        description: voice.description,
        voiceId: voice.voiceId,
        shadowed: (model.modelVoices ?? []).includes(voice.name)
      })),
      defaultVoice: model.defaultVoice,
      missing
    },
    engine: state.engineInfo
  };
}

async function saveSettings(raw) {
  const settings = normalizeSettings(raw);
  if (needsReload(settings)) {
    if (state.session) stop();
    disposeEngine();
  }
  await api.storage.local.set({ settings });
  return describeState();
}

async function handleMessage(message) {
  switch (message?.type) {
    case "get-state":
      return describeState();
    case "save-settings":
      return saveSettings(message.settings);
    case "speak": {
      // Not awaited: the reply says the speech started, and status updates follow.
      const text = message.text || TEST_TEXT[normalizeSettings(message.settings).lang] || TEST_TEXT.en;
      speak(text, message.voice).catch((error) => fail(error));
      return { ok: true };
    }
    case "voices-changed": {
      // The engine was built with the old voice list; rebuild on the next speak.
      if (state.session) stop();
      if (state.enginePromise) await state.enginePromise.catch(() => {});
      disposeEngine();
      return describeState();
    }
    case "stop":
      stop();
      return { ok: true };
    default:
      return { ok: false, error: "unknown message" };
  }
}

api.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message).then(
    (value) => sendResponse(value),
    (error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) })
  );
  return true;
});

updateBadge();
