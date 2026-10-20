// Settings, kept apart from the browser glue so they can be tested in Node.

/** Languages Phonon can normalize text for. `none` passes text through as written. */
export const LANGS = ["en", "fr", "de", "es", "pt", "none"];

/** Where generation runs. `auto` takes WebGPU when the browser hands out a real adapter. */
export const DEVICES = ["auto", "cpu", "webgpu"];

export const DEFAULTS = {
  lang: "en",
  voice: "default",
  device: "auto",
  temperature: 0.3,
  // The name of the checkpoint imported into browser storage. Empty until one is picked.
  modelName: ""
};

const TEMPERATURE_MIN = 0;
const TEMPERATURE_MAX = 2;

function pick(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

/**
 * Coerce whatever is in storage into a usable settings object. Unknown or malformed
 * values fall back to the defaults rather than breaking the next click.
 */
export function normalizeSettings(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const hasTemperature = source.temperature !== null && source.temperature !== undefined && source.temperature !== "";
  const temperature = hasTemperature ? Number(source.temperature) : NaN;

  return {
    lang: pick(source.lang, LANGS, DEFAULTS.lang),
    voice: typeof source.voice === "string" && source.voice.trim() ? source.voice.trim() : DEFAULTS.voice,
    device: pick(source.device, DEVICES, DEFAULTS.device),
    temperature: Number.isFinite(temperature)
      ? Math.min(TEMPERATURE_MAX, Math.max(TEMPERATURE_MIN, temperature))
      : DEFAULTS.temperature,
    modelName: typeof source.modelName === "string" ? source.modelName.trim() : DEFAULTS.modelName
  };
}

/** Read and normalize settings through an extension storage API (`browser.storage.local`). */
export async function readSettings(api) {
  const stored = await api.storage.local.get("settings");
  return normalizeSettings(stored?.settings);
}
