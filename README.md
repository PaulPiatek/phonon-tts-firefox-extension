# ff-phonon-tts

A Firefox extension that reads selected text aloud with
[Phonon](https://huggingface.co/gradium/phonon-40m-multilingual), running entirely inside the
browser: no server, no API key, no network at runtime.

It is the same interaction as [`ff-tts`](../ff-tts): select text, click the toolbar button or
right-click → **🔊 Phonon**, and hear it. The difference is where the audio comes from — the
model is WebAssembly in an extension worker instead of a local TTS backend.

## What it does

- **Toolbar button** — speaks the current selection; click again (or right-click → **🔇 Stop
  Phonon**) to stop.
- **Context menu** — **🔊 Phonon** on any selection.
- **Streams** — the first audio starts as soon as the first 80 ms frame is generated; the rest
  keeps generating while it plays.
- **Runs on the CPU** by default, and on **WebGPU** when the browser hands out a real adapter
  (setting: `Auto`). On a typical laptop the CPU build is around 5× faster than real time,
  single-threaded.
- **Options page** — import the model folder, import voices, language, device, temperature, and a
  Speak button for trying a sentence.

The model uses about 100 MB of memory while loaded. Firefox terminates idle extension
background pages, so after a long pause the next click reloads the checkpoint (well under a
second from browser storage) and then speaks.

The extension ships **no model**: you download the files and import them once.

## Setup

### 1. Get the model files

The multilingual 40m repo is gated, so accept its terms on
[huggingface.co/gradium/phonon-40m-multilingual](https://huggingface.co/gradium/phonon-40m-multilingual)
first. The extension reads only these four files:

| File | Size |
| --- | --- |
| `config.json` | 2.9 KB |
| `tokenizer.json` | 278 KB |
| `model.q8.gguf` | 74.6 MB |
| `default-voice.safetensors` | 256 KB |

**With the Hugging Face CLI.** Install it with `pip install -U huggingface_hub`, or run it without
installing via [`uvx`](https://docs.astral.sh/uv/guides/tools/). Log in once with `hf auth login`
(or set `HF_TOKEN`), since the model is gated.

Download the whole repository (~260 MB — it also contains `model.q4k.gguf`, `model.safetensors`
and `tokenizer.model`, which the extension ignores):

```powershell
hf download gradium/phonon-40m-multilingual --local-dir models/phonon-40m-multilingual
```

Or download only the four files the extension reads (~75 MB):

```powershell
hf download gradium/phonon-40m-multilingual `
  config.json tokenizer.json model.q8.gguf default-voice.safetensors `
  --local-dir models/phonon-40m-multilingual
```

`uvx` works the same way: `uvx hf download gradium/phonon-40m-multilingual ...` (the `hf` PyPI
package is the CLI; `uvx --from huggingface_hub hf ...` is equivalent). It caches the tool, so
later runs are instant.

**Without the CLI**, the bundled script downloads the same four files and writes `voices.json`:

```powershell
$env:HF_TOKEN = "hf_..."        # read token from https://huggingface.co/settings/tokens
npm install
npm run fetch-model             # -> models/phonon-40m-multilingual
```

The script skips files that are already there, so it is safe to re-run. `npm run fetch-model --
--help` lists the options.

**Another checkpoint**: the whole Phonon family works the same way. The public English
`phonon-31m-en` is useful for a quick smoke test:

```powershell
hf download gradium/phonon-31m-en --local-dir models/phonon-31m-en
# or: npm run fetch-model -- --repo gradium/phonon-31m-en --out models/phonon-31m-en
```

### 2. Import it in the extension

Open the extension's **Settings** → **Model** → **Import a model folder…** and pick the folder
holding the four files (and `voices.json` / `voices/` if you have them). Firefox copies the files
into the extension's own storage once; after that they work offline. **Delete** removes the copy,
and importing again replaces it, so re-import after replacing the files.

The model name is the folder name, so two checkpoints from differently named folders can be
switched between in the dropdown.

Browsers never give an extension a durable path to a folder on disk: a picker hands over the
*contents*. Copying them into the extension's storage is what makes "pick once, use forever"
possible. Nothing is uploaded anywhere.

### 3. Add voices (optional)

Every checkpoint brings one `default` voice. More voices are small `.safetensors` files (about
256 KB each) from the public
[gradium/phonon-voices](https://huggingface.co/gradium/phonon-voices) catalog (~100 voices) or
Gradium Studio.

Download the whole catalog (~34 MB; it also contains `samples/`, which the extension ignores):

```powershell
hf download gradium/phonon-voices --local-dir models/phonon-voices
```

Or only the voices and their names (~25 MB):

```powershell
hf download gradium/phonon-voices `
  --include "voices/*.safetensors" --include "voices.jsonl" `
  --local-dir models/phonon-voices
```

Then **Settings → Voices → Folder…** and pick `models/phonon-voices` (the folder with
`voices.jsonl`). Or use **Import voice files…** for a handful of `.safetensors`. Names,
languages and descriptions come from `voices.jsonl`; a file without it falls back to its file
name (catalog files are named by voice id, so the listing is worth including).

Voices are stored in the browser and **shared by every imported model** — the file format is the
same across the Phonon family. `Use` selects one, `Preview` speaks the text in the Try-it box
with it without changing the saved voice, and `×` deletes it. With many voices, the **Search**
box filters the list by name, language or description. A model's own voice wins over a library
voice with the same name (every checkpoint has `default`). Importing a voice while a model is
loaded rebuilds that model on the next Speak, so the new voice is used immediately.

The browser build speaks ready-made voices only; voice cloning is not available.

If you would rather keep a voice inside a checkpoint, `npm run fetch-model -- --voice Zoey`
downloads it into the model folder, and importing that folder brings it along.

### 4. Load the extension

`about:debugging#/runtime/this-firefox` → **Load Temporary Add-on…** → pick
`src/manifest.json`. For a packaged install, `npm run build` writes a zip to
`web-ext-artifacts/` (rename it to `.xpi`, or sign it on AMO). The imported model lives in the
browser's storage, not the XPI, so the package stays small.

### 5. Check it

In **Settings**, pick the language of the text you read, then press **Speak** in the "Try it"
card. The status line reports load progress and the device the model is running on. With no
model imported, the Model card says so.

Every setting saves as soon as it changes — there is no Save button.

## Usage

Select text on any page, then:

- click the toolbar button, or
- right-click → **🔊 Phonon**.

Click the button again, or right-click → **🔇 Stop Phonon**, to stop.

The **Language** setting is the language of the *text*, not of the UI: it decides how numbers,
dates and symbols are read. Phonon 40m multilingual speaks English, French, German, Spanish and
Portuguese. Use **None** to pass text through as written. Changing it reloads the model on the
next Speak (the language is fixed when the model loads). The Model card lists the languages the
checkpoint was trained for and warns when the selected one is not among them.

## Diagnostics

- `npm test` — the Node test suite (settings, model spec, playback scheduling, and the
  background flow with a fake engine).
- `npm run bench -- --model models/phonon-31m-en --voice Zoey` — loads a model through the wasm
  build and writes `bench.wav`, printing load time and speed relative to real time. Useful to
  check a download and a voice without the browser.
- **Self-test page** — in `about:debugging`, find the extension and open
  `selftest.html` from its "Inspect" page, or visit
  `moz-extension://<uuid>/selftest.html`. It speaks one sentence through the real background
  pipeline and prints device, threads, sample rate and features.
- `npm run lint` — `web-ext lint` (must stay at 0 errors/warnings).

## How it fits together

| Path | What it is |
| --- | --- |
| `src/background.js` | MV3 event page: menus, toolbar, model lifetime, playback, keep-alive. |
| `src/engine.js` | The only place that imports the vendored runtime; tests replace it with a fake. |
| `src/model.js` | Describes the imported checkpoint and builds the runtime's `ModelSpec`. |
| `src/model-files.js` | Validates the files from the folder picker, reads `voices.json`, keeps only what the runtime opens. |
| `src/voice-files.js` | Validates picked voice files and names them from `voices.jsonl`. |
| `src/store.js` | Imported checkpoints and voices in IndexedDB, listed and deleted from the options page. |
| `src/player.js` | Schedules streamed `Float32Array` chunks on one 24 kHz `AudioContext`. |
| `src/settings.js` | Language, voice, device, temperature, imported model name. |
| `src/options.*` | Settings UI, model import/delete, live status. |
| `src/vendor/phonon-tts/` | [`phonon-tts`](https://www.npmjs.com/package/phonon-tts) 0.4.0, copied from `node_modules` by `npm run vendor`. Plain ES modules plus the wasm builds. |
| `scripts/fetch-model.mjs` | Downloads a checkpoint (and voices) from Hugging Face into `models/`. |

An imported model lives in IndexedDB as `Blob`s, and so does the voice library. The background
page reads them when the model loads and makes `blob:` URLs for the runtime, which only accepts
URLs; the URLs are revoked when the model is replaced. That is why the import happens in the
options page but the URLs are made in the background: a blob URL dies with the page that
created it. Model voices are used first; a library voice with a name the model already has is
skipped.

The runtime needs WebAssembly SIMD (all current Firefox, Chrome, Safari). Threads are not
available in extension pages, because those are not cross-origin isolated; the model runs on one
CPU thread, or on WebGPU when `Auto` finds an adapter.

## Licence

The extension code is unlicensed/personal. The runtime (`phonon-tts`) is MIT OR Apache-2.0. The
multilingual 40m model weights are **CC BY-NC 4.0** (non-commercial); the `phonon-31m-en` model
is Apache-2.0. The model files are not part of this repository.
