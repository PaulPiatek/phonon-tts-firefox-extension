# Third-party notices

## phonon-tts

The extension bundles the [`phonon-tts`](https://www.npmjs.com/package/phonon-tts) runtime,
part of [xn-ptts](https://github.com/gradium-ai/xn-ptts), Copyright Gradium.

It is licensed under the **MIT License OR the Apache License, Version 2.0**, at your option.
The full texts ship inside the extension package:

- `src/vendor/phonon-tts/LICENSE-MIT`
- `src/vendor/phonon-tts/LICENSE-APACHE`

The files are copied verbatim by `scripts/vendor-runtime.mjs`, which records the version in
`src/vendor/phonon-tts/VERSION`. No modifications are made to them.

## Icons

The toolbar and extension icons in `src/icons/` are original artwork by the extension author and
are covered by the extension's MIT licence.

## Bundled model

The extension package includes the English Phonon 31M checkpoint,
[`gradium/phonon-31m-en`](https://huggingface.co/gradium/phonon-31m-en): `config.json`,
`tokenizer.json`, `model.q8.gguf` and `default-voice.safetensors`, copied from this repository's
`models/phonon-31m-en/` by `scripts/package-assets.mjs`.

Those files are **Apache-2.0**, which permits redistribution and commercial use. The licence text
ships in `src/vendor/phonon-tts/LICENSE-APACHE`; the weights are unmodified.

## Imported models and voices

Other checkpoints and voice files are not part of this repository or the extension package. Users
import files they downloaded themselves. The terms that apply to those files are:

- [`gradium/phonon-40m-multilingual`](https://huggingface.co/gradium/phonon-40m-multilingual):
  **CC BY-NC 4.0** (non-commercial).
- [`gradium/phonon-31m-en`](https://huggingface.co/gradium/phonon-31m-en): **Apache-2.0**.
- [`gradium/phonon-voices`](https://huggingface.co/gradium/phonon-voices): **Apache-2.0**.

Consult each repository for the authoritative terms.
