# AGENTS.md

## Layout

- `src/` — Firefox MV3 extension. `background.js` is a module event page and does everything at
  runtime: menus, model lifetime, playback. `options.*` is the settings page.
- `src/vendor/phonon-tts/` — the runtime, copied from `node_modules/phonon-tts` by
  `npm run vendor`. Never edit by hand; bump the dependency and re-run.
- `src/store.js` + `src/model-files.js` — the only model source: a folder picked in the options
  page is validated, copied into IndexedDB as blobs, and listed by name. No model ships with the
  extension and there is no models folder to read.
- `scripts/` — `fetch-model.mjs` (Hub download into `models/`), `bench.mjs` (wasm diagnostic),
  `vendor-runtime.mjs`.

## Commands

- `npm test` — full Node test suite. Must pass after every change.
- `npm run lint` — `web-ext lint`, must stay at 0 errors / 0 warnings.
- `npm run vendor` — refresh `src/vendor/phonon-tts` after changing the dependency.
- `npm run fetch-model -- --voice Zoey` — model/voices into `models/…`, to import in the UI.
- `npm run bench -- --model models/phonon-31m-en` — real wasm run in Node, writes `bench.wav`.
- Load for testing: `about:debugging#/runtime/this-firefox` → Load Temporary Add-on →
  `src/manifest.json`.

## Things that bite

- **The background page must stay alive while it works.** Firefox kills idle MV3 event pages.
  `updateKeepAlive()` pings `runtime.getPlatformInfo()` every 15 s while `state.session` or
  `state.enginePromise` exists. Any new long-running path must go through it, or audio dies
  mid-sentence and the model reloads.
- **The AudioContext is opened inside the click**, before the model load and before the first
  `await`. Created seconds later outside the gesture it can stay suspended.
- **Extension pages are not cross-origin isolated**, so wasm threads are unavailable: the
  runtime reports 1 thread and that is expected. Do not try to "fix" it. WebGPU works and is
  opt-in through `device: 'auto'`.
- **The model is gated on Hugging Face.** `hf://` URLs cannot be used from the browser (no
  token); the extension only reads models imported through the options page.
- **There is exactly one model source**: an imported record in IndexedDB
  (`settings.modelName`). An empty name is a valid state — `describeModel` returns `source:
  "none"` and `buildSpec` throws a message telling the user to import a model. Do not add a
  bundled-model fallback.
- **Imported models become blob URLs in the background page, never in the options page.** A blob
  URL dies with the document that created it, and the background page is what restarts and
  reloads the model. `disposeEngine` must revoke `state.blobUrls`, and a failed load must revoke
  the URLs it just made.
- **`unlimitedStorage`** is in the manifest because an imported checkpoint is ~75 MB of
  IndexedDB. Do not remove it.
- **`cache: false`** on `PhononTTS.load`: the checkpoint is local, so Cache API copies are pure
  duplication.
- **Firefox MV3 CSP needs `'wasm-unsafe-eval'`** in `content_security_policy.extension_pages`, or
  the runtime cannot compile its wasm. `worker.js` is a module worker; `script-src 'self'` covers
  it.
- **`default-voice.safetensors` is the voice named `default`**; the runtime has no built-in
  voice. A manifest with voices but no `default` key makes the first voice the default.
- **`npm run bench` bypasses phonon-tts** and talks to the vendored wasm module directly, so it
  works in Node where `Worker`/`AudioContext` do not.
- The model speaks 24 kHz mono, 80 ms frames. `player.js` holds ~300 ms before scheduling the
  first chunk; generation is normally much faster than playback.
