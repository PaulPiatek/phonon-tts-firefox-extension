// The one place that touches the vendored phonon-tts runtime. Tests swap the loader for
// a fake, so background.js can be exercised without WebAssembly or a worker.

let engineLoader = null;

/** @param {(options: object) => Promise<any>} loader */
export function setEngineLoader(loader) {
  engineLoader = loader;
}

export function resetEngineLoader() {
  engineLoader = null;
}

/**
 * Load a checkpoint and start its worker.
 *
 * `cache: false` on purpose: the files sit in the extension, so caching them in the Cache
 * API would only duplicate the checkpoint on disk, and voice files are small enough to read
 * again on the rare reload.
 */
export function loadEngine({ settings, spec, onProgress }) {
  const loader = engineLoader ?? defaultLoader;
  return loader({
    lang: settings.lang,
    model: spec,
    quant: "q8",
    device: settings.device,
    cache: false,
    onProgress
  });
}

async function defaultLoader(options) {
  const { PhononTTS } = await import("./vendor/phonon-tts/index.js");
  return PhononTTS.load(options);
}
