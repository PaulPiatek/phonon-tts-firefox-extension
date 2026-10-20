import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WEB_EXT_CLI = join(ROOT, "node_modules", "web-ext", "bin", "web-ext.js");

function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (answer) => {
    rl.close();
    resolve(answer.trim());
  }));
}

function askHidden(question) {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    const stdout = process.stdout;
    stdout.write(question);
    let value = "";
    const onData = (buffer) => {
      const text = buffer.toString();
      for (const char of text) {
        const code = char.charCodeAt(0);
        if (char === "\n" || char === "\r" || code === 4) {
          stdin.removeListener("data", onData);
          if (stdin.setRawMode) stdin.setRawMode(false);
          stdin.pause();
          stdout.write("\n");
          resolve(value.trim());
          return;
        }
        if (code === 3) {
          stdout.write("\n");
          process.exit(130);
        }
        if (code === 127 || code === 8) {
          value = value.slice(0, -1);
          continue;
        }
        if (code >= 32) value += char;
      }
    };
    if (stdin.isTTY && stdin.setRawMode) stdin.setRawMode(true);
    stdin.resume();
    stdin.on("data", onData);
  });
}

async function resolveCredentials() {
  let key = process.env.WEB_EXT_API_KEY?.trim();
  let secret = process.env.WEB_EXT_API_SECRET?.trim();

  if (key && secret) {
    console.log("Using WEB_EXT_API_KEY / WEB_EXT_API_SECRET from the environment.");
    return { key, secret };
  }

  console.log("Get a key pair at https://addons.mozilla.org/developers/addon/api/key/");
  if (!key) key = await ask("API key (JWT issuer): ");
  if (!secret) secret = await askHidden("API secret (JWT secret): ");

  if (!key || !secret) {
    console.error("Both the API key and secret are required.");
    process.exit(1);
  }
  return { key, secret };
}

if (!existsSync(WEB_EXT_CLI)) {
  console.error(`web-ext not found at ${WEB_EXT_CLI}. Run 'npm install' first.`);
  process.exit(1);
}

const { key, secret } = await resolveCredentials();

console.log("Signing with web-ext (channel 'unlisted' from .web-ext-config.mjs)...");
const child = spawn(process.execPath, [WEB_EXT_CLI, "sign", ...process.argv.slice(2)], {
  stdio: "inherit",
  env: { ...process.env, WEB_EXT_API_KEY: key, WEB_EXT_API_SECRET: secret }
});

child.on("error", (error) => {
  console.error("Failed to run web-ext:", error.message);
  process.exit(1);
});
child.on("exit", (code) => process.exit(code ?? 1));
