import { collectModelFiles } from "./model-files.js";
import { deleteModel, listModels, putModel } from "./store.js";

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
  lang: $("lang"),
  voice: $("voice"),
  device: $("device"),
  temperature: $("temperature"),
  temperatureValue: $("temperature-value"),
  form: $("form"),
  save: $("save"),
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
  if (imported.length === 0) {
    const option = node("option", "No model imported");
    option.value = "";
    els.modelName.append(option);
  }
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

async function refresh() {
  imported = await listModels().catch(() => []);
  render(await send({ type: "get-state" }));
}

async function saveForm() {
  showStatus("Saving…");
  const state = await send({ type: "save-settings", settings: readForm() });
  render(state);
  return state;
}

els.temperature.addEventListener("input", () => {
  els.temperatureValue.textContent = Number(els.temperature.value).toFixed(2);
});

els.lang.addEventListener("change", () => {
  const previous = sampleLang ? SAMPLES[sampleLang] : "";
  if (!els.preview.value || els.preview.value === previous) els.preview.value = SAMPLES[els.lang.value] || SAMPLES.en;
  sampleLang = els.lang.value;
});

els.modelName.addEventListener("change", async () => {
  els.deleteModel.disabled = !els.modelName.value;
  await saveForm();
  if (els.modelName.value) showStatus("Model switched; it loads on the next Speak.", "ok");
});

els.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  els.save.disabled = true;
  await saveForm();
  els.save.disabled = false;
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
    els.modelName.value = record.name;
    await saveForm();
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
    await saveForm();
    showStatus(`Deleted ${name}. The extension will use the folder option.`, "ok");
  } catch (error) {
    showStatus("Could not delete: " + (error?.message ?? error), "error");
  }
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
