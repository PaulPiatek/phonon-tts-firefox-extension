import { test, beforeEach, afterEach, describe } from "node:test";
import assert from "node:assert/strict";

import { installAudioStub } from "./helpers.mjs";
import { Player } from "../src/player.js";

function pcm(length, value = 0.5) {
  return new Float32Array(length).fill(value);
}

describe("Player", () => {
  let audio;

  beforeEach(() => {
    audio = installAudioStub();
  });

  afterEach(() => {
    delete globalThis.AudioContext;
  });

  test("start opens a 24 kHz context and resumes it", () => {
    const player = new Player({ prebufferMs: 0 });
    player.start();

    const context = audio.contexts[0];
    assert.ok(context);
    assert.equal(context.sampleRate, 24000);
    assert.equal(context.resumed, true);
    assert.equal(player.active, true);
  });

  test("start throws when the browser has no Web Audio", () => {
    delete globalThis.AudioContext;
    const player = new Player();
    assert.throws(() => player.start(), /no Web Audio/);
  });

  test("holds the first chunks until the prebuffer is full", () => {
    const player = new Player({ sampleRate: 1000, prebufferMs: 100 });
    player.start();

    player.push(pcm(40));
    player.push(pcm(40));
    assert.equal(audio.contexts[0].sources.length, 0, "under 100 samples stays buffered");

    player.push(pcm(40));
    assert.equal(audio.contexts[0].sources.length, 3, "the third chunk flushes the buffer");
    const context = audio.contexts[0];
    assert.equal(context.buffers.length, 3);
    assert.ok(Math.abs(context.buffers[0].getChannelData(0)[0] - 0.5) < 1e-6);
  });

  test("schedules chunks back to back with a small lead", () => {
    const player = new Player({ sampleRate: 1000, prebufferMs: 0 });
    player.start();
    const context = audio.contexts[0];

    player.push(pcm(100));
    player.push(pcm(100));

    assert.ok(Math.abs(context.sources[0].startTime - 0.06) < 1e-9);
    assert.ok(Math.abs(context.sources[1].startTime - 0.16) < 1e-9);
  });

  test("finish plays what is buffered and reports idle after the last source ends", () => {
    let idle = 0;
    const player = new Player({ sampleRate: 1000, prebufferMs: 1000, onIdle: () => idle++ });
    player.start();
    player.push(pcm(100));
    assert.equal(audio.contexts[0].sources.length, 0);

    player.finish();
    const context = audio.contexts[0];
    assert.equal(context.sources.length, 1);
    assert.equal(idle, 0);

    context.sources[0].onended();
    assert.equal(idle, 1);
  });

  test("finish with no audio at all reports idle straight away, once", () => {
    let idle = 0;
    const player = new Player({ onIdle: () => idle++ });
    player.start();
    player.finish();
    player.finish();
    assert.equal(idle, 1);
  });

  test("stop silences the sources, closes the context and stays quiet", () => {
    let idle = 0;
    const player = new Player({ sampleRate: 1000, prebufferMs: 0, onIdle: () => idle++ });
    player.start();
    player.push(pcm(100));
    player.push(pcm(100));

    player.stop();

    const context = audio.contexts[0];
    assert.equal(context.closed, true);
    assert.ok(context.sources.every((source) => source.stopped));
    assert.equal(player.active, false);

    player.push(pcm(100));
    player.finish();
    assert.equal(context.sources.length, 2, "no new source after stop");
    assert.equal(idle, 0);
  });

  test("a chunk is ignored before start", () => {
    const player = new Player();
    player.push(pcm(10));
    assert.equal(audio.contexts.length, 0);
  });
});
