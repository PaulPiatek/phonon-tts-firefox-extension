// Speaks a sentence with a model folder, straight through the wasm build, and writes a WAV.
// This is a diagnostic, not part of the extension: it checks that the files are complete and
// shows how fast the CPU build is on this machine.
//
//   npm run bench -- --model models/phonon-31m-en --text "Hello there."
//   npm run bench -- --model models/phonon-40m-multilingual --lang de --text "Guten Tag."
//
// The model still has to be fetched first (npm run fetch-model).

import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function args(argv) {
  const options = {
    model: join(root, "models/phonon-31m-en"),
    text: "Hello. Phonon is running inside your browser, with no server.",
    lang: "en",
    voice: "default",
    out: join(root, "bench.wav")
  };
  for (let i = 0; i < argv.length; i++) {
    const value = () => argv[++i];
    switch (argv[i]) {
      case "--model":
        options.model = resolve(value());
        break;
      case "--text":
        options.text = value();
        break;
      case "--lang":
        options.lang = value();
        break;
      case "--voice":
        options.voice = value();
        break;
      case "--out":
        options.out = resolve(value());
        break;
      default:
        throw new Error(`unknown option ${argv[i]}`);
    }
  }
  return options;
}

function wav(pcm, sampleRate) {
  const data = Buffer.alloc(pcm.length * 2);
  for (let i = 0; i < pcm.length; i++) {
    data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(pcm[i] * 32767))), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

async function main() {
  const options = args(process.argv.slice(2));
  const read = (name) => readFile(join(options.model, name));

  const [wasmModule, weights, tokenizer, configJson, manifestText] = await Promise.all([
    readFile(join(root, "src/vendor/phonon-tts/wasm/phonon_tts_simd_bg.wasm")),
    read("model.q8.gguf"),
    read("tokenizer.json"),
    read("config.json"),
    readFile(join(options.model, "voices.json"), "utf8").catch(() => '{"default":"default-voice.safetensors"}')
  ]);
  const manifest = JSON.parse(manifestText);
  const voiceFile = manifest[options.voice] ?? manifest.default;

  const { default: init, Model } = await import("../src/vendor/phonon-tts/wasm/phonon_tts.js");
  const t0 = performance.now();
  const module = await WebAssembly.compile(wasmModule);
  await init({ module_or_path: module });
  const model = await Model.load(weights, tokenizer, configJson, "q8", options.lang, "default", [], "cpu");
  const voiceBytes = await readFile(join(options.model, voiceFile));
  const voiceIndex = model.add_voice(voiceBytes);
  await model.flush();
  console.log(
    `loaded ${options.lang} in ${((performance.now() - t0) / 1000).toFixed(2)}s · ` +
      `${model.sample_rate()} Hz · voice ${options.voice} (${voiceFile})`
  );

  const started = performance.now();
  let first = null;
  const total = model.start_generation(voiceIndex, options.text, 0.3, 4242424242424242n);
  const samples = [];
  for (;;) {
    if (model.next_chunk() === undefined) break;
    for (;;) {
      const pcm = await model.generation_step();
      if (pcm === undefined) break;
      if (first === null && pcm.length) first = performance.now() - started;
      samples.push(Float32Array.from(pcm));
    }
  }
  model.stop_generation?.();

  const sampleRate = model.sample_rate();
  const all = new Float32Array(samples.reduce((sum, chunk) => sum + chunk.length, 0));
  let offset = 0;
  for (const chunk of samples) {
    all.set(chunk, offset);
    offset += chunk.length;
  }
  const elapsed = (performance.now() - started) / 1000;
  const audio = all.length / sampleRate;
  await writeFile(options.out, wav(all, sampleRate));
  console.log(
    `${total} text chunks · ${audio.toFixed(2)}s of audio in ${elapsed.toFixed(2)}s ` +
      `(${(audio / elapsed).toFixed(2)}x real time, first audio at ${(first / 1000).toFixed(2)}s)`
  );
  console.log(`wrote ${options.out}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
