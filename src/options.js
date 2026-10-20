import { collectModelFiles } from "./model-files.js";
import { collectVoiceFiles } from "./voice-files.js";
import { deleteModel, deleteVoice, listModels, putModel, putVoices } from "./store.js";

const api = globalThis.browser ?? globalThis.chrome;
const SAMPLES = {
  en: "Hello. Phonon is running inside your browser, with no server.",
  fr: "Bonjour. Phonon fonctionne dans votre navigateur, sans serveur.",
  de: "Hallo. Phonon läuft in Ihrem Browser, ohne Server.",
  es: "Hola. Phonon se ejecuta en tu navegador, sin servidor.",
  pt: "Olá. O Phonon está a ser executado no seu navegador, sem servidor.",
  none: "Hello. Phonon is running inside your browser, with no server."
};

const $ = (id) => document.getElementById(id);
const els = {
  status: $("status"),
  modelName: $("modelName"),
  importModel: $("importModel"),
  deleteModel: $("deleteModel"),
  modelPicker: $("modelPicker"),
  modelInfo: $("model-info"),
  missing: $("missing"),
  importVoices: $("importVoices"),
  importVoiceFolder: $("importVoiceFolder"),
  voicePicker: $("voicePicker"),
  voiceFolderPicker: $("voiceFolderPicker"),
  voiceList: $("voice-list"),
  lang: $("lang"),
  voice: $("voice"),
  device: $("device"),
  temperature: $("temperature"),
  temperatureValue: $("temperature-value"),
  form: $("form"),
  preview: $("preview"),
  speak: $("speak"),
  stop: $("stop"),
  engineInfo: $("engine-info")
};

let imported = [];
let sampleLang = null;

function mb(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(bytes > 10 * 1024 * 1024 ? 0 : 1)} MB`;
}

function showStatus(text, kind) {
  els.status.textContent = text;
  els.status.className = "status" + (kind ? " " + kind : "");
}

async function send(message) {
  try {
    return await api.runtime.sendMessage(message);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function node(tag, text) {
  const element = document.createElement(tag);
  element.textContent = text;
  return element;
}

function badge(text, className) {
  const element = node("span", text);
  element.className = className ? `badge ${className}` : "badge";
  return element;
}

function voiceRow(model, name, kind, voice) {
  const row = document.createElement("div");
  row.className = "voice-row";

  const main = document.createElement("div");
  main.className = "voice-main";
  const title = document.createElement("div");
  title.className = "voice-name";
  title.append(node("strong", name));
  title.append(badge(kind === "model" ? "model" : "library", kind === "model" ? "model" : ""));
  if (voice?.shadowed) {
    title.append(badge("hidden by model", "shadowed"));
    title.lastChild.title = "The model ships a voice with this name, which is used instead.";
  }
  if (voice?.language) {
    const meta = node("span", voice.language);
    meta.className = "voice-meta";
    title.append(meta);
  }
  main.append(title);
  if (voice?.description) {
    const description = node("div", voice.description);
    description.className = "voice-desc";
    main.append(description);
  }
  row.append(main);

  const actions = document.createElement("div");
  actions.className = "voice-actions";

  const use = node("button", "Use");
  use.type = "button";
  use.className = "mini";
  use.addEventListener("click", async () => {
    els.voice.value = name;
    await saveForm();
    showStatus(`Voice: ${name}`, "ok");
  });
  actions.append(use);

  const preview = node("button", "Preview");
  preview.type = "button";
  preview.className = "mini ghost";
  if (voice?.shadowed) {
    preview.disabled = true;
    preview.title = "The model ships a voice with this name, so this one cannot be used.";
  }
  preview.addEventListener("click", async () => {
    showStatus(`Previewing ${name}…`, "ok");
    await send({ type: "speak", text: els.preview.value, voice: name });
  });
  actions.append(preview);

  if (kind === "library") {
    const remove = node("button", "×");
    remove.type = "button";
    remove.className = "mini danger";
    remove.title = `Delete ${name} from this browser`;
    remove.addEventListener("click", async () => {
      if (!confirm(`Delete the voice "${name}" from this browser?`)) return;
      const wasSelected = els.voice.value === name;
      await deleteVoice(name);
      let state = await send({ type: "voices-changed" });
      if (wasSelected) {
        els.voice.value = state.model.modelVoices.includes("default") ? "default" : state.model.modelVoices[0] ?? "";
        state = await saveForm({ quiet: true });
      } else {
        render(state);
      }
      showStatus(`Deleted ${name}`, "ok");
    });
    actions.append(remove);
  }

  row.append(actions);
  return row;
}

function renderVoices(model) {
  els.voiceList.replaceChildren();
  for (const name of model.modelVoices) els.voiceList.append(voiceRow(model, name, "model", null));
  for (const voice of model.library) els.voiceList.append(voiceRow(model, voice.name, "library", voice));
  if (model.modelVoices.length === 0 && model.library.length === 0) {
    const empty = node("div", "No voices yet. Import one above, or import a model (its own voices come with it).");
    empty.className = "hint";
    els.voiceList.append(empty);
  }
}

function missingNodes(model) {
  if (model.source === "none") {
    return [
      node("strong", "No model imported yet."),
      document.createElement("br"),
      document.createTextNode(
        "Press “Import a model folder…” above and pick the folder with config.json, tokenizer.json, model.q8.gguf and default-voice.safetensors."
      )
    ];
  }
  const nodes = [node("strong", "Model unavailable: ")];
  model.missing.forEach((name, index) => {
    nodes.push(node("code", name));
    nodes.push(document.createTextNode(index === model.missing.length - 1 ? "." : ", "));
  });
  nodes.push(document.createElement("br"), document.createTextNode("Import the model folder again to fix it."));
  return nodes;
}
function engineSummary(engine) {
  if (!engine) return "Not loaded yet. The first click loads the checkpoint.";
  const parts = [
    `${engine.device} (${engine.deviceReason})`,
    `${engine.threads} thread${engine.threads === 1 ? "" : "s"} (${engine.threadsReason})`,
    `${Math.round(engine.sampleRate / 1000)} kHz`
  ];
  return "Running on " + parts.join(" · ");
}

function renderModelChoices(settings) {
  els.modelName.replaceChildren();
  const placeholder = node("option", imported.length === 0 ? "No model imported" : "Choose a model…");
  placeholder.value = "";
  placeholder.disabled = true;
  els.modelName.append(placeholder);
  for (const model of imported) {
    const option = node("option", `Imported: ${model.name} (${mb(model.bytes)})`);
    option.value = model.name;
    els.modelName.append(option);
  }
  if (settings.modelName && !imported.some((model) => model.name === settings.modelName)) {
    const option = node("option", `Missing: ${settings.modelName}`);
    option.value = settings.modelName;
    els.modelName.append(option);
  }
  els.modelName.value = settings.modelName || "";
  els.deleteModel.disabled = !els.modelName.value;
}

function render(state) {
  if (!state || state.ok === false) {
    showStatus("Could not reach the extension background: " + (state?.error || "unknown error"), "error");
    return;
  }
  const settings = state.settings;
  const model = state.model;

  renderModelChoices(settings);
  els.lang.value = settings.lang;
  els.device.value = settings.device;
  els.temperature.value = String(settings.temperature);
  els.temperatureValue.textContent = Number(settings.temperature).toFixed(2);

  els.voice.replaceChildren();
  for (const name of model.voices) {
    const option = node("option", name === model.defaultVoice ? name + " (default)" : name);
    option.value = name;
    els.voice.append(option);
  }
  if (model.voices.length === 0) {
    const option = node("option", "(no voices)");
    option.value = "";
    els.voice.append(option);
  }
  els.voice.value = model.voices.includes(settings.voice) ? settings.voice : model.defaultVoice ?? "";

  const source = model.source === "imported" ? "imported, in browser storage" : "no model imported";
  els.modelInfo.textContent =
    model.source === "none"
      ? "No model imported"
      : `${model.modelDir} · ${source} · ${model.voices.length} voice${model.voices.length === 1 ? "" : "s"}`;

  renderVoices(model);

  if (model.source === "none" || model.missing.length > 0) {
    els.missing.classList.remove("hidden");
    els.missing.replaceChildren(...missingNodes(model));
  } else {
    els.missing.classList.add("hidden");
    els.missing.textContent = "";
  }

  els.engineInfo.textContent = engineSummary(state.engine);
  if (state.active) showStatus(state.status.text, "ok");
  else if (state.error) showStatus("Error: " + state.error, "error");
  else showStatus(state.status.text || "Idle", "");

  if (sampleLang !== settings.lang) {
    const previous = sampleLang ? SAMPLES[sampleLang] : "";
    if (!els.preview.value || els.preview.value === previous) els.preview.value = SAMPLES[settings.lang] || SAMPLES.en;
    sampleLang = settings.lang;
  }
}

function readForm() {
  return {
    lang: els.lang.value,
    voice: els.voice.value,
    device: els.device.value,
    temperature: Number(els.temperature.value),
    modelName: els.modelName.value
  };
}

let renderSeq = 0;

async function refresh() {
  const seq = ++renderSeq;
  imported = await listModels().catch(() => []);
  const state = await send({ type: "get-state" });
  // A save or import that started later must win over this slower reply.
  if (seq === renderSeq) render(state);
}

async function saveForm({ quiet = false } = {}) {
  const seq = ++renderSeq;
  const state = await send({ type: "save-settings", settings: readForm() });
  if (seq === renderSeq) {
    render(state);
    if (!quiet && state?.ok !== false && !state.active && !state.error) showStatus("Saved", "ok");
  }
  return state;
}

els.temperature.addEventListener("input", () => {
  els.temperatureValue.textContent = Number(els.temperature.value).toFixed(2);
});

els.lang.addEventListener("change", () => {
  const previous = sampleLang ? SAMPLES[sampleLang] : "";
  if (!els.preview.value || els.preview.value === previous) els.preview.value = SAMPLES[els.lang.value] || SAMPLES.en;
  sampleLang = els.lang.value;
  saveForm();
});

els.voice.addEventListener("change", () => saveForm());
els.device.addEventListener("change", () => saveForm());
els.temperature.addEventListener("change", () => saveForm());

els.modelName.addEventListener("change", async () => {
  els.deleteModel.disabled = !els.modelName.value;
  const state = await saveForm();
  if (state?.ok !== false) showStatus("Model switched; it loads on the next Speak.", "ok");
});

els.form.addEventListener("submit", (event) => {
  event.preventDefault();
  saveForm();
});

els.importModel.addEventListener("click", () => els.modelPicker.click());

els.modelPicker.addEventListener("change", async () => {
  const files = [...els.modelPicker.files];
  els.modelPicker.value = "";
  if (files.length === 0) return;

  els.importModel.disabled = true;
  showStatus("Reading the folder…");
  try {
    const record = await collectModelFiles(files);
    showStatus(`Copying ${record.name} (${mb(record.bytes)}) into browser storage…`);
    await putModel(record);
    imported = await listModels();
    // Select the new model right away, including on a fresh install where the dropdown
    // had nothing selected before.
    els.modelName.value = record.name;
    const state = await saveForm({ quiet: true });
    if (state?.settings?.modelName !== record.name) {
      // Something re-rendered the select in between; do it once more, now that lists agree.
      imported = await listModels();
      els.modelName.value = record.name;
      await saveForm({ quiet: true });
    }
    showStatus(`Imported ${record.name}. It loads on the next Speak.`, "ok");
  } catch (error) {
    showStatus("Import failed: " + (error?.message ?? error), "error");
  } finally {
    els.importModel.disabled = false;
    els.deleteModel.disabled = !els.modelName.value;
  }
});

els.deleteModel.addEventListener("click", async () => {
  const name = els.modelName.value;
  if (!name) return;
  if (!confirm(`Delete the imported model "${name}" from browser storage?`)) return;
  els.deleteModel.disabled = true;
  try {
    await deleteModel(name);
    imported = await listModels();
    els.modelName.value = "";
    await saveForm({ quiet: true });
    showStatus(`Deleted ${name}. Import a model to speak again.`, "ok");
  } catch (error) {
    showStatus("Could not delete: " + (error?.message ?? error), "error");
  }
});

async function importVoices(files) {
  els.importVoices.disabled = true;
  els.importVoiceFolder.disabled = true;
  showStatus("Reading the voices…");
  try {
    const { voices, skipped } = await collectVoiceFiles(files);
    showStatus(`Storing ${voices.length} voice${voices.length === 1 ? "" : "s"}…`);
    await putVoices(voices);
    // The engine holds the voice list from when it loaded; make it rebuild with the new ones.
    render(await send({ type: "voices-changed" }));
    const extra = skipped.length ? `, ${skipped.length} file${skipped.length === 1 ? "" : "s"} skipped` : "";
    showStatus(`Imported ${voices.length} voice${voices.length === 1 ? "" : "s"}${extra}.`, "ok");
  } catch (error) {
    showStatus("Voice import failed: " + (error?.message ?? error), "error");
  } finally {
    els.importVoices.disabled = false;
    els.importVoiceFolder.disabled = false;
  }
}

els.importVoices.addEventListener("click", () => els.voicePicker.click());
els.importVoiceFolder.addEventListener("click", () => els.voiceFolderPicker.click());

els.voicePicker.addEventListener("change", async () => {
  const files = [...els.voicePicker.files];
  els.voicePicker.value = "";
  if (files.length > 0) await importVoices(files);
});

els.voiceFolderPicker.addEventListener("change", async () => {
  const files = [...els.voiceFolderPicker.files];
  els.voiceFolderPicker.value = "";
  if (files.length > 0) await importVoices(files);
});

els.speak.addEventListener("click", async () => {
  const saved = await saveForm();
  if (saved?.ok === false) return;
  await send({ type: "speak", text: els.preview.value });
});

els.stop.addEventListener("click", async () => {
  await send({ type: "stop" });
});

api.runtime.onMessage.addListener((message) => {
  if (message?.type !== "status") return;
  if (message.active) showStatus(message.text || "Working…", "ok");
  else if (message.badge === "!") showStatus(message.text, "error");
  else showStatus(message.text || "Idle", message.ok ? "ok" : "");
});

refresh();
