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
  // Passed to the model as its `duration_delta` conditioner: negative is faster, positive slower.
  durationDelta: 0,
  // Empty selects the bundled Phonon 31M checkpoint; otherwise the name of an imported one.
  modelName: ""
};

const TEMPERATURE_MIN = 0;
const TEMPERATURE_MAX = 2;
const DURATION_MIN = -0.5;
const DURATION_MAX = 0.5;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

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
  const hasDuration = source.durationDelta !== null && source.durationDelta !== undefined && source.durationDelta !== "";
  const durationDelta = hasDuration ? Number(source.durationDelta) : NaN;

  return {
    lang: pick(source.lang, LANGS, DEFAULTS.lang),
    voice: typeof source.voice === "string" && source.voice.trim() ? source.voice.trim() : DEFAULTS.voice,
    device: pick(source.device, DEVICES, DEFAULTS.device),
    temperature: Number.isFinite(temperature) ? clamp(temperature, TEMPERATURE_MIN, TEMPERATURE_MAX) : DEFAULTS.temperature,
    durationDelta: Number.isFinite(durationDelta) ? clamp(durationDelta, DURATION_MIN, DURATION_MAX) : DEFAULTS.durationDelta,
    modelName: typeof source.modelName === "string" ? source.modelName.trim() : DEFAULTS.modelName
  };
}

/** Read and normalize settings through an extension storage API (`browser.storage.local`). */
export async function readSettings(api) {
  const stored = await api.storage.local.get("settings");
  return normalizeSettings(stored?.settings);
}
