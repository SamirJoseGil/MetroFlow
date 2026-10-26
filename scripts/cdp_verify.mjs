/**
 * Verificación persistente en navegador real (CDP) de las correcciones de
 * interfaz. Recorre las tres experiencias y las interacciones que cambiaron;
 * imprime PASS/FAIL por comprobación y sale con código 1 si alguna falla.
 *
 * Uso: node scripts/cdp_verify.mjs [urlBase]
 * Requiere que la API sirva el frontend (./build.ps1 -Serve).
 */

const base = process.argv[2] ?? "http://localhost:18080";

const CHROME_CANDIDATES = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
];
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const chrome = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!chrome) throw new Error("no se encontró Chrome/Edge");

const PORT = 9224;
const profile = mkdtempSync(join(tmpdir(), "cdp-verify-"));
const proc = spawn(chrome, [
  "--headless=new", "--disable-gpu",
  "--window-size=1440,1100",
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  "about:blank",
], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForHttp(u, tries = 50) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(u); if (r.ok) return await r.json(); } catch {}
    await sleep(200);
  }
  throw new Error("sin respuesta de chrome devtools");
}

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

try {
  const targets = await waitForHttp(`http://127.0.0.1:${PORT}/json`);
  const page = targets.find((t) => t.type === "page");
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
  await send("Emulation.setDeviceMetricsOverride", {
    width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false,
  });

  async function evalJs(expression) {
    const r = await send("Runtime.evaluate", {
      expression, returnByValue: true, awaitPromise: true,
    });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r.result.value;
  }
  async function load(url) {
    await send("Page.navigate", { url });
    await sleep(5000);
  }

  // ---- A1: marcas de cierre solo en incidencias -------------------------
  await load(`${base}/?o=1&d=15&m=incident&x=8-9`);
  const a1 = await evalJs(`(async()=>{
    const m0=document.querySelectorAll('.closed-mark').length;
    document.querySelector('.mode-tab[data-mode=plan]').click();
    await new Promise(r=>setTimeout(r,1200));
    const m1=document.querySelectorAll('.closed-mark').length;
    document.querySelector('.mode-tab[data-mode=incident]').click();
    await new Promise(r=>setTimeout(r,1200));
    const m2=document.querySelectorAll('.closed-mark').length;
    return {m0,m1,m2};
  })()`);
  check("A1 marcas de cierre visibles solo en incidencias",
    a1.m0 === 2 && a1.m1 === 0 && a1.m2 === 2, JSON.stringify(a1));

  // ---- A2/A3/A8/A9: laboratorio -----------------------------------------
  await load(`${base}/?o=1&d=15&m=lab`);
  const a2 = await evalJs(`(async()=>{
    const play=document.getElementById('lab-play');
    play.click();
    await new Promise(r=>setTimeout(r,1000));
    document.getElementById('lab-prev').click();
    await new Promise(r=>setTimeout(r,500));
    return {
      label: play.textContent.trim(),
      step: document.getElementById('lab-step').textContent,
      events: document.querySelectorAll('#lab-events li').length,
      focusable: document.querySelectorAll('#lab-events li[tabindex]').length,
      role: document.querySelector('.metro-map').getAttribute('role'),
      sideTabIndex: document.querySelector('.side').tabIndex,
    };
  })()`);
  check("A2 prev durante reproducción detiene el temporizador",
    a2.label === "Reproducir" && !a2.step.startsWith("1 /"), JSON.stringify(a2));
  check("A8 eventos del laboratorio enfocables por teclado",
    a2.focusable === a2.events && a2.events > 0, JSON.stringify(a2));
  check("A9 mapa SVG con role=group (no img)", a2.role === "group", a2.role);
  check("A6 destino del skip-link enfocable", a2.sideTabIndex === -1, String(a2.sideTabIndex));

  const a3 = await evalJs(`(async()=>{
    const range=document.getElementById('lab-range');
    range.value='60'; range.dispatchEvent(new Event('input'));
    await new Promise(r=>setTimeout(r,150));
    const nxt=document.getElementById('lab-next');
    for(let i=0;i<10;i++) nxt.click();
    await new Promise(r=>setTimeout(r,150));
    const after=document.querySelectorAll('.explore-edge').length;
    for(let i=0;i<5;i++) document.getElementById('lab-prev').click();
    await new Promise(r=>setTimeout(r,150));
    const back=document.querySelectorAll('.explore-edge').length;
    return {after,back};
  })()`);
  check("A3 rastro de aristas sin duplicar", a3.after === a3.back && a3.after > 0, JSON.stringify(a3));

  // ---- A7: buscador accesible -------------------------------------------
  await load(`${base}/`);
  const a7 = await evalJs(`(async()=>{
    const opener=document.getElementById('search-global');
    opener.focus();
    opener.click();
    await new Promise(r=>setTimeout(r,150));
    const input=document.getElementById('search-input');
    const overlay=document.getElementById('search-overlay');
    const closeBtn=overlay.querySelector('[data-close]');
    const out={role:input.getAttribute('role'), expanded:input.getAttribute('aria-expanded')};
    input.value='bel'; input.dispatchEvent(new Event('input'));
    await new Promise(r=>setTimeout(r,150));
    out.active=input.getAttribute('aria-activedescendant');
    out.count=document.getElementById('search-count').textContent;
    // Trampa de foco: Tab desde el último control (input) vuelve al primero
    // (botón cerrar), y Shift+Tab desde el primero vuelve al último.
    input.focus();
    input.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true}));
    out.wrapToEnd=document.activeElement===closeBtn;
    closeBtn.focus();
    closeBtn.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',shiftKey:true,bubbles:true}));
    out.wrapToStart=document.activeElement===input;
    // Escape cierra y devuelve el foco al abridor.
    input.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
    await new Promise(r=>setTimeout(r,150));
    out.restored=document.activeElement.id;
    return out;
  })()`);
  check("A7 buscador: combobox, activedescendant, trampa de foco y restauración",
    a7.role === "combobox" && a7.active?.startsWith("search-opt-") &&
    a7.wrapToEnd && a7.wrapToStart && a7.restored === "search-global" &&
    a7.count?.includes("57"),
    JSON.stringify(a7));

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} comprobaciones superadas`);
  if (failed > 0) process.exitCode = 1;
  ws.close();
} catch (err) {
  console.error("ERROR:", err.message);
  process.exitCode = 1;
} finally {
  proc.kill();
}
