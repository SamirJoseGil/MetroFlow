import type { Criterion, Trace, TraceEvent } from "./api";
import type { ExploredEdge } from "./map";
import { icon } from "./icons";

/**
 * Laboratorio de algoritmos. Todo se deriva de los eventos REALES emitidos por
 * el motor C++ (Trace.hpp): no se inventan eventos ni actualizaciones.
 *
 * Cada evento de la traza produce un "frame" con:
 *  - contadores acumulados hasta ese momento,
 *  - conjunto de estaciones asentadas / en frontera,
 *  - estado activo (estación, línea) y conexión evaluada,
 *  - dist(v) selectivo (últimas estaciones tocadas),
 *  - líneas de pseudocódigo asociadas a ese evento.
 */

export type Algorithm = "dijkstra" | "bfs";

export interface LabCounters {
  insertions: number;
  extractions: number;
  evaluated: number;
  updates: number;
  stale: number;
  settled: number;
}

export interface LabFrame {
  index: number;
  event: TraceEvent;
  counters: LabCounters;
  settled: Set<number>;
  frontier: Set<number>;
  activeNode: number | null;
  edge: ExploredEdge | null;
  dists: Map<number, number>;
  pred: Map<number, number>;
  pcLines: string[]; // ids de instrucciones activas
  stateLabel: string; // estado (estación, línea) activo
}

interface PseudocodeDef {
  title: string;
  lines: Array<{ id: string; text: string }>;
}

export const PSEUDOCODE: Record<Algorithm, PseudocodeDef> = {
  dijkstra: {
    title: "Dijkstra sobre estados (estación, línea)",
    lines: [
      { id: "d1", text: "función dijkstra_estados(origen, destino):" },
      { id: "d2", text: "  distancia[s] ← ∞ para todo estado s" },
      { id: "d3", text: "  predecesor[s] ← nulo" },
      { id: "d4", text: "  distancia[origen] ← 0" },
      { id: "d5", text: "  insertar origen en la cola de prioridad" },
      { id: "d6", text: "  mientras la cola no esté vacía:" },
      { id: "d7", text: "    u ← extraer estado de menor costo provisional" },
      { id: "d8", text: "    si la entrada es obsoleta: descartar y continuar" },
      { id: "d9", text: "    asentar u con su distancia definitiva" },
      { id: "d10", text: "    si u está en la estación destino: terminar" },
      { id: "d11", text: "    por cada conexión saliente disponible (u → v):" },
      { id: "d12", text: "      candidato ← dist(u) + penalty si cambia línea" +
        " + tiempo(v)" },
      { id: "d13", text: "      si candidato < dist(v):" },
      { id: "d14", text: "        dist(v) ← candidato" },
      { id: "d15", text: "        predecesor(v) ← u" },
      { id: "d16", text: "        insertar v en la cola" },
      { id: "d17", text: "  ruta ← reconstruir desde el mejor estado final" },
    ],
  },
  bfs: {
    title: "BFS por niveles (saltos)",
    lines: [
      { id: "b1", text: "función bfs(origen, destino):" },
      { id: "b2", text: "  nivel[v] ← −1 para toda estación v" },
      { id: "b3", text: "  predecesor[v] ← nulo" },
      { id: "b4", text: "  nivel[origen] ← 0" },
      { id: "b5", text: "  introducir origen en la cola FIFO" },
      { id: "b6", text: "  mientras la cola no esté vacía:" },
      { id: "b7", text: "    u ← frente de la cola" },
      { id: "b8", text: "    asentar u (orden de descubrimiento niveles)" },
      { id: "b9", text: "    si u = destino: terminar" },
      { id: "b10", text: "    por cada conexión saliente disponible (u → v):" },
      { id: "b11", text: "      examinar la conexión" },
      { id: "b12", text: "      si v no tiene nivel asignado:" },
      { id: "b13", text: "        nivel[v] ← nivel[u] + 1" },
      { id: "b14", text: "        predecesor[v] ← u" },
      { id: "b15", text: "        introducir v al final de la cola" },
      { id: "b16", text: "  ruta ← reconstruir con los predecesores" },
    ],
  },
};

export function algorithmOf(criterion: Criterion): Algorithm {
  return criterion === "hops" ? "bfs" : "dijkstra";
}

/** Corresponde explícita evento → instrucciones de pseudocódigo. */
function pcFor(algorithm: Algorithm, ev: TraceEvent, isFirstPush: boolean): string[] {
  if (algorithm === "dijkstra") {
    switch (ev.type) {
      case "init": return ["d1", "d2", "d3", "d4"];
      case "push": return isFirstPush ? ["d5"] : ["d13", "d14", "d16"];
      case "skip": return ["d7", "d8"];
      case "extract": return ["d7", "d9"];
      case "relax": return ["d11", "d12"];
      case "update_dist": return ["d13", "d14"];
      case "update_parent": return ["d13", "d14", "d15", "d16"];
      case "path": return ["d17"];
      default: return [];
    }
  }
  switch (ev.type) {
    case "push": return isFirstPush ? ["b5"] : ["b12", "b13", "b15"];
    case "extract": return ["b7", "b8", "b9"];
    case "relax": return ["b10", "b11"];
    case "update_dist": return ["b12", "b13"];
    case "update_parent": return ["b12", "b14", "b15"];
    case "path": return ["b16"];
    default: return ["b1"];
  }
}

function fmt(v: number): string {
  if (!Number.isFinite(v)) return "∞";
  const s = v.toFixed(1);
  return s.endsWith(".0") ? String(Math.round(v)) : s;
}

/** Narración construida a partir del evento y de sus datos reales. */
export function narration(frame: LabFrame, names: Map<number, string>): string {
  const ev = frame.event;
  const name = (id: number): string => names.get(id) ?? String(id);
  const node = ev.nodeName ?? name(ev.node);
  const from = ev.fromName ?? (ev.from >= 0 ? name(ev.from) : "");
  switch (ev.type) {
    case "init":
      return `Se inicializa la búsqueda desde ${node}: d=0 y todo lo demás en ∞.`;
    case "push":
      return frame.counters.insertions === 1 && !frame.edge
        ? `${node} entra a la cola con costo 0.`
        : `${node} [${ev.line}] entra en la frontera con costo provisional d=${fmt(ev.dist)}.`;
    case "skip":
      return `La entrada de ${node} está obsoleta: su mejor costo ya es d=${fmt(ev.previous)}; se descarta la copia con d=${fmt(ev.dist)}.`;
    case "extract":
      return `Se extrae el estado ${node} [${ev.line}] con el menor costo provisional y queda asentado en d=${fmt(ev.dist)}.`;
    case "relax":
      return `Se evalúa la conexión ${from} → ${node} (línea ${ev.line}): candidato d=${fmt(ev.dist)} frente a d=${Number.isFinite(ev.previous) ? fmt(ev.previous) : "∞"}.`;
    case "update_dist":
      return `Mejora encontrada: d(${node}) pasa de ${Number.isFinite(ev.previous) ? fmt(ev.previous) : "∞"} a ${fmt(ev.dist)} min vía ${from}.`;
    case "update_parent":
      return `Se actualiza el predecesor de ${node}: ${ev.previousFrom !== undefined && ev.previousFrom >= 0 ? `${name(ev.previousFrom)} ⇒ nuevo: ` : "quedan: "}${from}${ev.fromLine ? ` [${ev.fromLine}]` : ""}.`;
    case "path":
      return `Tramo reconstruido ${from} → ${node} (línea ${ev.line}, ${fmt(ev.previous)} min). Costo total ${fmt(ev.dist)} min.`;
    default:
      return ev.note;
  }
}

export interface LabInput {
  trace: Trace;
  algorithm: Algorithm;
  criterion: Criterion;
  transferPenalty: number;
  names: Map<number, string>;
  linesSummary: string;
}

/** Construye la lista de frames acumulados (una vez por traza, O(n) copias
 *  de conjuntos pequeños: la red tiene 57 estaciones). */
export function buildFrames(input: LabInput): LabFrame[] {
  const { trace, algorithm } = input;
  const counters: LabCounters = {
    insertions: 0,
    extractions: 0,
    evaluated: 0,
    updates: 0,
    stale: 0,
    settled: 0,
  };
  const settled = new Set<number>();
  const frontier = new Set<number>();
  const distAll = new Map<number, number>();
  const pred = new Map<number, number>();
  const recent: number[] = [];
  let edge: ExploredEdge | null = null;
  let activeNode: number | null = null;

  const frames: LabFrame[] = [];
  const firstPushIdx = trace.events.findIndex((e) => e.type === "push");
  for (let i = 0; i < trace.events.length; i++) {
    const ev = trace.events[i];
    switch (ev.type) {
      case "init":
        if (ev.node >= 0) distAll.set(ev.node, ev.dist);
        break;
      case "push":
        frontier.add(ev.node);
        counters.insertions++;
        if (ev.node >= 0) distAll.set(ev.node, ev.dist);
        break;
      case "extract":
        counters.settled++;
        counters.extractions++;
        settled.add(ev.node);
        frontier.delete(ev.node);
        activeNode = ev.node;
        if (ev.node >= 0) distAll.set(ev.node, ev.dist);
        break;
      case "skip":
        counters.stale++;
        break;
      case "relax":
        counters.evaluated++;
        break;
      case "update_dist":
        counters.updates++;
        counters.insertions++; // cada mejora inserta un estado en la cola
        frontier.add(ev.node);
        distAll.set(ev.node, ev.dist);
        break;
      case "update_parent":
        // Emparejado con update_dist: no altera contadores externos.
        break;
      case "path":
        break;
      default:
        break;
    }

    if (ev.type === "update_parent" && ev.node >= 0 && ev.from >= 0) {
      pred.set(ev.node, ev.from);
    }
    if (ev.type === "relax" || ev.type === "update_dist" || ev.type === "update_parent") {
      edge = { from: ev.from, to: ev.node, line: ev.line };
    }

    // Ventana selectiva de dist(v): origen, destino y estaciones tocadas en
    // los últimos eventos.
    if (ev.node >= 0) recent.push(ev.node);
    if (ev.from >= 0) recent.push(ev.from);
    while (recent.length > 12) recent.shift();
    const dists = new Map<number, number>();
    for (const id of recent) {
      const d = distAll.get(id);
      if (d !== undefined) dists.set(id, d);
    }

    frames.push({
      index: i,
      event: ev,
      counters: { ...counters },
      settled: new Set(settled),
      frontier: new Set(frontier),
      activeNode,
      edge: edge ? { ...edge } : null,
      dists,
      pred: new Map(pred),
      pcLines: pcFor(algorithm, ev, i === firstPushIdx),
      stateLabel: stateLabelOf(ev, input.names),
    });
  }
  return frames;
}

function stateLabelOf(ev: TraceEvent, names: Map<number, string>): string {
  const n = (id: number): string => names.get(id) ?? String(id);
  switch (ev.type) {
    case "init":
    case "push":
      return `${ev.nodeName ?? n(ev.node)}${ev.line ? ` · ${ev.line}` : ""}`;
    case "extract":
    case "skip":
      return `${ev.nodeName ?? n(ev.node)} · ${ev.line || "—"} (asentado)`;
    case "relax":
      return `${ev.fromName ?? n(ev.from)}${ev.fromLine ? ` · ${ev.fromLine}` : ""} → ${ev.nodeName ?? n(ev.node)} · ${ev.line}`;
    case "update_dist":
    case "update_parent":
      return `${ev.nodeName ?? n(ev.node)} · ${ev.line} (frontera)`;
    case "path":
      return `${ev.fromName ?? n(ev.from)} → ${ev.nodeName ?? n(ev.node)} · ${ev.line}`;
    default:
      return "";
  }
}

/** Ruta reconstruida desde los eventos `path` (o el árbol de predecesores). */
export function routeFromFrames(
  frames: LabFrame[],
): { found: boolean; stationIds: number[]; legs: Array<{ from: number; to: number; line: string }> } {
  const path = frames.filter((f) => f.event.type === "path");
  if (path.length > 0) {
    const legs = path.map((f) => ({
      from: f.event.from,
      to: f.event.node,
      line: f.event.line,
    }));
    const stationIds = [
      legs[0]?.from,
      ...legs.map((l) => l.to),
    ].filter((id): id is number => typeof id === "number" && id >= 0);
    return { found: true, stationIds, legs };
  }
  // BFS no emite eventos path: reconstruye desde pred (estación, no estado).
  const roots = frames.filter((f) => f.event.type === "extract");
  const target = roots.length > 0 ? roots[roots.length - 1].event.node : -1;
  if (target < 0) return { found: false, stationIds: [], legs: [] };
  const pred = frames[frames.length - 1].pred;
  const chain: number[] = [target];
  let cur = target;
  while (pred.has(cur) && chain.length < 100) {
    const p = pred.get(cur)!;
    chain.unshift(p);
    cur = p;
  }
  if (chain.length < 2) return { found: false, stationIds: [], legs: [] };
  const legs = [];
  for (let i = 0; i < chain.length - 1; i++) legs.push({
    from: chain[i],
    to: chain[i + 1],
    line: "",
  });
  return { found: true, stationIds: chain, legs };
}

export interface LabCallbacks {
  onFrame(frame: LabFrame): void;
  onViewRoute(): void;
}

export class LabController {
  private timer: number | null = null;
  private playing = false;
  private index = 0;
  private speed = 1; // 0.5 | 1 | 2
  private destroyed = false;

  constructor(
    private panel: HTMLElement,
    private frames: LabFrame[],
    private input: LabInput,
    private callbacks: LabCallbacks,
  ) {
    this.render();
    this.goto(0, false);
  }

  destroy(): void {
    this.destroyed = true;
    this.stopTimer();
  }

  current(): LabFrame {
    return this.frames[Math.min(this.index, this.frames.length - 1)];
  }

  private stopTimer(): void {
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
    this.playing = false;
    this.syncPlayButton();
  }

  private syncPlayButton(): void {
    const play = this.panel.querySelector<HTMLButtonElement>("#lab-play");
    if (play) {
      play.innerHTML = this.playing
        ? `${icon("pause", 14)} Pausar`
        : `${icon("play", 14)} Reproducir`;
    }
  }

  private render(): void {
    const pseudo = PSEUDOCODE[this.input.algorithm];
    const total = this.frames.length;
    this.panel.innerHTML = `
      <div class="panel-head">
        <p class="eyebrow">Laboratorio · ${esc(this.input.algorithm === "bfs" ? "BFS" : "Dijkstra")}</p>
        <h2 class="lab-title">${esc(pseudo.title)}</h2>
        <p class="lab-criterion">Criterio: <strong>${esc(this.input.linesSummary)}</strong>
          ${this.input.algorithm === "dijkstra" ? `· transbordo ${esc(fmtPenalty(this.input.transferPenalty))} min` : ""}</p>
      </div>

      <div class="lab-controls" role="group" aria-label="Reproducción">
        <button id="lab-play" class="btn small primary" type="button">${icon("play", 14)} Reproducir</button>
        <button id="lab-prev" class="icon-btn small" type="button" aria-label="Evento anterior">${icon("prev", 14)}</button>
        <button id="lab-next" class="icon-btn small" type="button" aria-label="Evento siguiente">${icon("next", 14)}</button>
        <input id="lab-range" type="range" min="0" max="${total - 1}" value="0" aria-label="Posición del evento en la traza">
        <button id="lab-reset" class="icon-btn small" type="button" aria-label="Reiniciar">${icon("reset", 14)}</button>
        <span class="lab-counter mono" id="lab-step" aria-live="off">1 / ${total}</span>
        <select id="lab-speed" class="speed-select" aria-label="Velocidad de reproducción">
          <option value="0.5">0.5×</option>
          <option value="1" selected>1×</option>
          <option value="2">2×</option>
        </select>
      </div>

      <div class="lab-tabs" role="tablist" aria-label="Vistas del laboratorio">
        <button class="lab-tab is-active" role="tab" type="button" aria-selected="true"
          data-lab-view="ejecucion" id="lab-tab-ejecucion">Ejecución</button>
        <button class="lab-tab" role="tab" type="button" aria-selected="false"
          data-lab-view="pseudocodigo" id="lab-tab-pseudocodigo">Pseudocódigo</button>
        <button class="lab-tab" role="tab" type="button" aria-selected="false"
          data-lab-view="eventos" id="lab-tab-eventos">Eventos</button>
        <button class="lab-tab" role="tab" type="button" aria-selected="false"
          data-lab-view="estadisticas" id="lab-tab-estadisticas">Estadísticas</button>
      </div>

      <div class="lab-body">
        <section class="lab-view is-active" data-lab-view="ejecucion" aria-labelledby="lab-tab-ejecucion">
          <div class="lab-narration" aria-live="polite">
            <p class="eyebrow">Narración</p>
            <p class="lab-current" id="lab-current" role="status"></p>
            <p class="lab-state mono" id="lab-state"></p>
          </div>
          <div class="lab-complete">
            <button id="lab-goRoute" class="btn small ghost" type="button" disabled>
              ${icon("route", 14)} Ver el recorrido resultante
            </button>
            <span class="status" id="lab-final"></span>
          </div>
        </section>

        <section class="lab-view" data-lab-view="pseudocodigo" aria-labelledby="lab-tab-pseudocodigo">
          <div class="pc-panel">
            <p class="eyebrow">Pseudocódigo</p>
            <ol class="pc-lines" id="lab-pc">
              ${pseudo.lines.map((l) => `<li class="pc-line" data-pc="${l.id}"><code>${esc(l.text)}</code></li>`).join("")}
            </ol>
          </div>
        </section>

        <section class="lab-view" data-lab-view="eventos" aria-labelledby="lab-tab-eventos">
          <p class="eyebrow">Lista de eventos (${total})</p>
          <ol id="lab-events" class="events"></ol>
        </section>

        <section class="lab-view" data-lab-view="estadisticas" aria-labelledby="lab-tab-estadisticas">
          <div class="lab-stats-block">
            <p class="eyebrow">Estadísticas acumuladas</p>
            ${labStatsMarkup()}
            <p class="lab-engine-note">Tiempo de ejecución del motor (total): <span class="mono" id="lab-elapsed">${this.input.trace.stats.elapsedMs.toFixed(3)}</span> ms</p>
          </div>
        </section>
      </div>`;

    this.wirePlayback();
    this.wireViewTabs();
    this.renderEventList();
  }

  private wireViewTabs(): void {
    this.panel.querySelectorAll<HTMLButtonElement>(".lab-tab").forEach((tab) => {
      tab.addEventListener("click", () => this.setView(tab.dataset.labView ?? "ejecucion"));
    });
  }

  /** Cambia la vista del cuerpo sin tocar la reproducción ni los eventos. */
  private setView(view: string): void {
    this.panel.querySelectorAll<HTMLElement>(".lab-tab").forEach((tab) => {
      const active = tab.dataset.labView === view;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-selected", String(active));
    });
    this.panel.querySelectorAll<HTMLElement>(".lab-view").forEach((panel) => {
      panel.classList.toggle("is-active", panel.dataset.labView === view);
    });
    // Al mostrar la lista de eventos, lleva el evento activo a la vista.
    if (view === "eventos") {
      const active = this.panel.querySelector<HTMLElement>("#lab-events li.active");
      active?.scrollIntoView({ block: "nearest" });
    }
  }

  private renderEventList(): void {
    const list = this.panel.querySelector<HTMLOListElement>("#lab-events")!;
    list.replaceChildren();
    this.frames.forEach((frame, i) => {
      const li = document.createElement("li");
      li.className = `ev ${frame.event.type}`;
      li.dataset.index = String(i);
      li.tabIndex = 0; // salto a un evento concreto también con teclado
      const label = frame.event.nodeName ?? String(frame.event.node);
      li.innerHTML = `
        <span class="ev-type">${esc(frame.event.type)}</span>
        <b>${esc(label)}</b>
        <span class="ev-line">${esc(frame.event.line || "")}</span>
        <span class="ev-dist">d=${fmt(frame.event.dist)}</span>`;
      li.addEventListener("click", () => this.goto(i));
      li.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          this.goto(i);
        }
      });
      list.appendChild(li);
    });
  }

  private wirePlayback(): void {
    const play = this.panel.querySelector<HTMLButtonElement>("#lab-play")!;
    const prev = this.panel.querySelector<HTMLButtonElement>("#lab-prev")!;
    const next = this.panel.querySelector<HTMLButtonElement>("#lab-next")!;
    const reset = this.panel.querySelector<HTMLButtonElement>("#lab-reset")!;
    const range = this.panel.querySelector<HTMLInputElement>("#lab-range")!;
    const speed = this.panel.querySelector<HTMLSelectElement>("#lab-speed")!;
    const go = this.panel.querySelector<HTMLButtonElement>("#lab-goRoute")!;

    play.addEventListener("click", () => {
      if (this.playing) {
        this.stopTimer();
        return;
      }
      this.startPlaying();
    });
    // Todo control manual (prev/next/reset/slider) detiene la reproducción:
    // sin esto, el temporizador en curso sobrescribiría la navegación manual
    // en el próximo tick.
    prev.addEventListener("click", () => {
      this.stopTimer();
      this.goto(this.index - 1);
    });
    next.addEventListener("click", () => {
      this.stopTimer();
      this.goto(this.index + 1);
      if (this.index >= this.frames.length - 1) this.markFinished();
    });
    reset.addEventListener("click", () => {
      this.stopTimer();
      this.goto(0, false, true);
    });
    range.addEventListener("input", () => {
      this.stopTimer();
      this.goto(Number(range.value), true);
    });
    speed.addEventListener("change", () => {
      this.speed = Number(speed.value) || 1;
      if (this.playing) this.startPlaying();
    });
    go.addEventListener("click", () => this.callbacks.onViewRoute());
  }

  private startPlaying(): void {
    this.stopTimer();
    if (this.index >= this.frames.length - 1) this.goto(0, false);
    this.playing = true;
    this.syncPlayButton();
    this.timer = window.setInterval(() => {
      if (this.index >= this.frames.length - 1) {
        this.stopTimer();
        this.markFinished();
        return;
      }
      this.goto(this.index + 1);
    }, this.intervalMs());
  }

  private intervalMs(): number {
    const base = 420;
    return Math.round(base / this.speed);
  }

  public goto(index: number, fromRange = false, silent = false): void {
    void fromRange;
    if (this.destroyed || this.frames.length === 0) return;
    this.index = Math.max(0, Math.min(this.frames.length - 1, index));
    const frame = this.current();
    const range = this.panel.querySelector<HTMLInputElement>("#lab-range");
    if (range && !fromRange) range.value = String(this.index);
    if (!silent) {
      const step = this.panel.querySelector<HTMLElement>("#lab-step");
      if (step) step.textContent = `${this.index + 1} / ${this.frames.length}`;
    }
    const list = this.panel.querySelector<HTMLOListElement>("#lab-events");
    if (list) {
      const items = list.children;
      const activeItem = items[this.index];
      for (const li of Array.from(items)) {
        (li as HTMLElement).classList.remove("active", "past");
      }
      for (let k = 0; k < this.index; k++) items[k]?.classList.add("past");
      activeItem?.classList.add("active");
      // Desplazamiento contenido a la lista: no se desplaza la página entera.
      const listRect = list.getBoundingClientRect();
      const itemRect = activeItem?.getBoundingClientRect();
      if (activeItem && itemRect) {
        if (itemRect.top < listRect.top) {
          list.scrollTop -= listRect.top - itemRect.top;
        } else if (itemRect.bottom > listRect.bottom) {
          list.scrollTop += itemRect.bottom - listRect.bottom;
        }
      }
    }
    const current = this.panel.querySelector<HTMLElement>("#lab-current");
    if (current) {
      current.textContent = `${frame.event.type} — ${narration(frame, this.input.names)}`;
    }
    const state = this.panel.querySelector<HTMLElement>("#lab-state");
    if (state) state.textContent = frame.stateLabel;
    this.highlightPseudocode(frame.pcLines);
    this.updateStats(frame);
    const finalBtn = this.panel.querySelector<HTMLButtonElement>("#lab-goRoute");
    if (finalBtn) {
      const lastHref =
        frame.event.type === "path" ||
        (this.index === this.frames.length - 1 &&
          (frame.counters.settled > 0 || this.input.algorithm === "bfs"));
      finalBtn.disabled = !lastHref;
    }
    this.callbacks.onFrame(frame);
  }

  private highlightPseudocode(active: string[]): void {
    const lines = this.panel.querySelectorAll<HTMLElement>(".pc-line");
    lines.forEach((el) => {
      const id = el.dataset.pc ?? "";
      el.classList.toggle("pc-active", active.includes(id));
    });
  }

  private updateStats(frame: LabFrame): void {
    const c = frame.counters;
    const nodes = this.panel.querySelectorAll<HTMLElement>(".stat");
    const values: Record<string, number> = {
      "stat-sim": c.insertions,
      "stat-ex": c.extractions,
      "stat-rel": c.evaluated,
      "stat-upd": c.updates,
      "stat-stale": c.stale,
      "stat-set": c.settled,
    };
    for (const el of nodes) {
      const key = el.dataset.stat;
      if (!key || !(key in values)) continue;
      const v = values[key];
      const out = el.querySelector<HTMLElement>(".stat-value");
      if (!out) continue;
      if (out.textContent !== String(v)) {
        out.textContent = String(v);
        el.classList.remove("stat-flash");
        void el.offsetWidth;
        el.classList.add("stat-flash");
      }
    }
  }

  private markFinished(): void {
    const go = this.panel.querySelector<HTMLButtonElement>("#lab-goRoute");
    if (go) go.disabled = false;
    // Estado final honesto y por algoritmo: refleja cómo se construyó la ruta
    // según los eventos reales del motor (path para Dijkstra, pred para BFS).
    const final = this.panel.querySelector<HTMLElement>("#lab-final");
    if (final) {
      final.textContent =
        this.input.algorithm === "bfs"
          ? "Reconstrucción por predecesores disponible."
          : "Traza completa: la ruta viene de los eventos path del motor.";
    }
  }
}

function labStatsMarkup(): string {
  const defs: Array<[string, string, string]> = [
    ["sim", "Inserciones en cola", "0"],
    ["ex", "Extracciones", "0"],
    ["rel", "Conexiones evaluadas", "0"],
    ["upd", "Actualizaciones", "0"],
    ["stale", "Entradas descartadas", "0"],
    ["set", "Estados asentados", "0"],
  ];
  return `<div class="lab-stats">${defs
    .map(
      ([id, label, value]) =>
        `<div class="stat" data-stat="stat-${id}">
          <span class="stat-value mono">${value}</span>
          <span class="stat-label">${esc(label)}</span>
        </div>`,
    )
    .join("")}</div>`;
}

function fmtPenalty(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
