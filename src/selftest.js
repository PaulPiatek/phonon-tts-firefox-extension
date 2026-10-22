// Runs one sentence through the real pipeline and prints what happened. The page title turns
// into SELFTEST OK / SELFTEST FAIL so an automated run can read the result without the DOM.

const api = globalThis.browser ?? globalThis.chrome;
const logEl = document.getElementById("log");
const lines = [];

function log(text) {
  lines.push(text);
  logEl.textContent = lines.join("\n");
}

function send(message) {
  return api.runtime.sendMessage(message);
}

async function waitFor(predicate, timeoutMs) {
  const started = Date.now();
  for (;;) {
    const state = await send({ type: "get-state" });
    if (predicate(state)) return state;
    if (Date.now() - started > timeoutMs) throw new Error("timed out waiting for the background");
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
}

async function run() {
  const state = await send({ type: "get-state" });
  log(`model: ${state.model.modelDir || "(none imported)"}`);
  log(`model source: ${state.model.source}`);
  log(`voices: ${state.model.voices.join(", ") || "(none)"} (default ${state.model.defaultVoice})`);
  if (state.model.source === "none") {
    throw new Error("no model imported; open the extension settings and import a model folder");
  }
  if (state.model.missing.length) throw new Error(`model unavailable: ${state.model.missing.join(", ")}`);

  const started = performance.now();
  await send({ type: "speak", text: "Hello. This is the Spokra self test, speaking from the extension." });
  log("asked the background page to speak; waiting for it to finish");

  const finished = await waitFor(
    (s) => !s.active && (s.status.text === "Done" || s.status.badge === "!"),
    180000
  );
  if (finished.status.badge === "!") throw new Error(finished.status.text);

  const engine = finished.engine;
  if (!engine) throw new Error("the engine did not stay loaded");
  log(`device: ${engine.device} (${engine.deviceReason})`);
  log(`threads: ${engine.threads} (${engine.threadsReason})`);
  log(`sample rate: ${engine.sampleRate}`);
  log(`languages: ${engine.languages.join(", ")}`);
  log(`features: ${JSON.stringify(engine.features)}`);
  log(`whole round trip: ${((performance.now() - started) / 1000).toFixed(1)}s`);
  return engine;
}

run().then(
  () => {
    log("RESULT OK");
    report("OK");
  },
  (error) => {
    log(`RESULT FAIL ${error?.message || error}`);
    if (error?.stack) log(String(error.stack));
    report("FAIL");
  }
);

async function report(result) {
  document.title = result === "OK" ? "SELFTEST OK" : "SELFTEST FAIL";
  // Nothing to report to when the page is opened by hand; that is fine.
  try {
    await fetch("http://127.0.0.1:8791/result", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: `RESULT ${result}\n` + lines.join("\n")
    });
  } catch {
    // Not running under the automated harness.
  }
}
