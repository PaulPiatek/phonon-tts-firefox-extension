// Plays the 80 ms PCM chunks the runtime streams in, back to back, on one AudioContext.
//
// The first chunks are held until `prebufferMs` of audio has arrived, so a slow first
// sentence does not turn into a gap right at the start. After that every chunk is
// scheduled behind the previous one, which is what makes the stream sound continuous.

export const DEFAULT_PREBUFFER_MS = 300;
/** Start this far in the future, so the first buffer is never scheduled in the past. */
const LEAD_SECONDS = 0.06;

export class Player {
  #AudioContextCtor;
  #onIdle;
  #sampleRate;
  #prebufferSamples;
  #context = null;
  #sources = new Set();
  #pending = [];
  #bufferedSamples = 0;
  #nextTime = 0;
  #finished = false;
  #stopped = false;
  #idleFired = false;

  constructor({
    AudioContextCtor = globalThis.AudioContext,
    sampleRate = 24000,
    prebufferMs = DEFAULT_PREBUFFER_MS,
    onIdle = () => {}
  } = {}) {
    this.#AudioContextCtor = AudioContextCtor;
    this.#onIdle = onIdle;
    this.#sampleRate = sampleRate;
    this.#prebufferSamples = Math.max(0, Math.round((prebufferMs / 1000) * sampleRate));
  }

  /** Whether audio is playing or waiting to be scheduled. */
  get active() {
    return Boolean(this.#context) && !this.#stopped;
  }

  get sampleRate() {
    return this.#sampleRate;
  }

  /** Open the audio device. Throws when the browser has no Web Audio. */
  start() {
    if (this.#context) return;
    if (!this.#AudioContextCtor) throw new Error("this browser has no Web Audio");
    this.#context = new this.#AudioContextCtor({ sampleRate: this.#sampleRate });
    this.#nextTime = this.#context.currentTime;
    this.#context.resume?.().catch(() => {});
  }

  /** Offer the next chunk of mono samples. */
  push(pcm) {
    if (this.#stopped || !this.#context || !pcm?.length) return;
    this.#pending.push(pcm);
    this.#bufferedSamples += pcm.length;
    if (this.#bufferedSamples >= this.#prebufferSamples) this.#drain();
  }

  /** No more audio is coming: play what is queued, then report idle once it has played. */
  finish() {
    if (this.#stopped || this.#finished) return;
    this.#finished = true;
    this.#drain();
    if (this.#sources.size === 0) this.#idle();
  }

  /** Stop everything and release the audio device. Does not fire `onIdle`. */
  stop() {
    if (this.#stopped) return;
    this.#stopped = true;
    this.#pending = [];
    this.#bufferedSamples = 0;
    for (const source of this.#sources) {
      try {
        source.stop();
      } catch {
        // A source that never started throws here; nothing to stop.
      }
    }
    this.#sources.clear();
    if (this.#context) {
      this.#context.close?.().catch(() => {});
      this.#context = null;
    }
  }

  #drain() {
    if (!this.#context || this.#pending.length === 0) return;
    for (const pcm of this.#pending) this.#schedule(pcm);
    this.#pending = [];
    this.#bufferedSamples = 0;
  }

  #schedule(pcm) {
    const context = this.#context;
    const buffer = context.createBuffer(1, pcm.length, this.#sampleRate);
    buffer.getChannelData(0).set(pcm);

    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    const start = Math.max(context.currentTime + LEAD_SECONDS, this.#nextTime);
    source.start(start);
    this.#nextTime = start + buffer.duration;
    this.#sources.add(source);
    source.onended = () => {
      this.#sources.delete(source);
      if (this.#finished && this.#sources.size === 0) this.#idle();
    };
  }

  #idle() {
    if (this.#idleFired) return;
    this.#idleFired = true;
    this.#onIdle();
  }
}
