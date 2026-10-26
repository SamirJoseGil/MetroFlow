/**
 * Captura de pantalla vía Chrome DevTools Protocol con acciones previas.
 *
 * Uso: node scripts/cdp_shot.mjs <url> <salida.png> [expresión JS a evaluar]
 *
 * Lanza un Chrome headless propio (puerto 9223), navega a la URL, evalúa la
 * expresión opcional dentro de la página, espera a que la red quede quieta y
 * guarda una captura PNG del viewport.
 */
import { spawn } from "node:child_process";
import { writeFileSync, mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [, , url, out, action = "", size = "1440x1100"] = process.argv;
if (!url || !out) {
  console.error("uso: cdp_shot.mjs <url> <salida.png> [acción JS] [WxH]");
  process.exit(1);
}
const [WIN_W, WIN_H] = size.split("x").map((n) => Number(n) || 0);

const CHROME_CANDIDATES = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
];
const chrome = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!chrome) {
  console.error("no se encontró Chrome/Edge");
  process.exit(1);
}

const PORT = 9223;
const profile = mkdtempSync(join(tmpdir(), "cdp-prof-"));
const proc = spawn(chrome, [
  "--headless=new",
  "--disable-gpu",
  `--window-size=${Math.max(WIN_W, 520)},${Math.max(WIN_H, 520)}`,
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  "about:blank",
], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForHttp(u, tries = 50) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(u);
      if (res.ok) return await res.json();
    } catch {}
    await sleep(200);
  }
  throw new Error("no response from chrome devtools");
}

try {
  const targets = await waitForHttp(`http://127.0.0.1:${PORT}/json`);
  const page = targets.find((t) => t.type === "page");
  if (!page) throw new Error("sin target page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

  let id = 0;
  const pending = new Map();
  const send = (method, params = {}) =>
    new Promise((res, rej) => {
      const mid = ++id;
      pending.set(mid, { res, rej });
      ws.send(JSON.stringify({ id: mid, method, params }));
    });
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
    }
  };

  await send("Page.enable");
  await send("Runtime.enable");
  const logs = [];
  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(String(ev.data));
    if (msg.method === "Runtime.consoleAPICalled") {
      const text = (msg.params.args ?? [])
        .map((a) => {
          if (a.value !== undefined) return String(a.value);
          if (a.description) return String(a.description);
          if (a.type === "object") return JSON.stringify(a);
          return String(a.type);
        })
        .join(" ");
      logs.push(`[console.${msg.params.type}] ${text}`);
    } else if (msg.method === "Runtime.exceptionThrown") {
      logs.push(`[exception] ${JSON.stringify(msg.params.exceptionDetails?.text ?? "")}`);
    }
  });
  await send("Emulation.setDeviceMetricsOverride", {
    width: WIN_W,
    height: WIN_H,
    deviceScaleFactor: 2,
    mobile: WIN_W < 700,
  });
  await send("Page.navigate", { url });
  await sleep(6000);

  if (action) {
    const result = await send("Runtime.evaluate", {
      expression: action,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result && result.result && result.result.value !== undefined) {
      console.log("ACTION ->", JSON.stringify(result.result.value));
    }
    await sleep(2500);
  }

  const shot = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(out, Buffer.from(shot.data, "base64"));
  console.log("OK ->", out);
  if (logs.length) console.log("LOGS:\n" + logs.slice(0, 40).join("\n"));
  ws.close();
} catch (err) {
  console.error("ERROR:", err.message);
  process.exitCode = 1;
} finally {
  proc.kill();
}
