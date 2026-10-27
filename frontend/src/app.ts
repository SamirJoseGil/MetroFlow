import "./styles/main.css";
import "./styles/map.css";
import {
  api,
  type Criterion,
  type ExportParams,
  type Graph,
  type Route,
  type Station,
} from "./api";
import { MapView, lineColor, lineName, LINE_INFO, type MapViewKind } from "./map";
import type { MapSurface } from "./mapsurface";
import { icon } from "./icons";
import {
  applyTheme,
  resolveInitialTheme,
  currentTheme,
  toggleTheme,
  type Theme,
} from "./theme";
import {
  LabController,
  algorithmOf,
  buildFrames,
  routeFromFrames,
  type LabFrame,
} from "./lab";
import { setUIHTML } from "./ui";

const app = document.getElementById("app")!;

/**
 * MapLibre se carga bajo demanda (sólo para la vista geográfica): el bundle
 * inicial se mantiene ligero y el SVG editorial sigue siendo el arranque.
 */
async function createMapSurface(
  graph: Graph,
  kind: MapViewKind,
  theme: Theme,
  fallback: MapSurface,
): Promise<MapSurface> {
  if (kind !== "geo") return fallback;
  const { createMapSurface: create } = await import("./maplibre");
  return create(graph, kind, theme, fallback);
}

type Mode = "plan" | "lab" | "incident";

interface HistoryEntry {
  ts: number;
  from: number;
  to: number;
  criterion: Criterion;
}

interface RouteComparison {
  original: Route;
  scenario: Route;
}

interface State {
  graph: Graph;
  map: MapSurface;
  kind: MapViewKind;
  mode: Mode;
  from: number | null;
  to: number | null;
  criterion: Criterion;
  runId: number;
  labRunId: number;
  lastPlan: Route | null;
  alternatives: Route[];
  activeIndex: number;
  activeRoute: Route | null;
  exportParams: ExportParams | null;
  lab: LabController | null;
  labFrames: LabFrame[] | null;
  edgeClickActive: boolean;
  closed: Set<string>;
  comparison: RouteComparison | null;
  history: HistoryEntry[];
  pinned: Set<string>;
}

/* ==================================================================== utils */

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function normalize(text: string): string {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function stationLabel(state: State, id: number | null): string {
  if (id === null) return "—";
  return state.graph.stations.find((s) => s.id === id)?.name ?? String(id);
}

/** Clave de tramo físico (par no dirigido de estaciones). */
function tramoKey(a: number, b: number): string {
  return `${Math.min(a, b)}:${Math.max(a, b)}`;
}

/** Todos los ids dirigidos que componen el tramo físico. */
function tramoIds(state: State, a: number, b: number): number[] {
  const key = tramoKey(a, b);
  const ids: number[] = [];
  state.graph.connections.forEach((c, index) => {
    if (tramoKey(c.from, c.to) === key) ids.push(c.id ?? index);
  });
  return ids;
}

function closedIds(state: State): number[] {
  const ids = new Set<number>();
  for (const key of state.closed) {
    const [a, b] = key.split(":").map(Number);
    if (Number.isFinite(a) && Number.isFinite(b)) {
      for (const id of tramoIds(state, a, b)) ids.add(id);
    }
  }
  return [...ids];
}

function closedNames(state: State): string[] {
  return [...state.closed].map((key) => {
    const [a, b] = key.split(":").map(Number);
    return `${stationLabel(state, a)} ↔ ${stationLabel(state, b)}`;
  });
}

function download(filename: string, text: string): void {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/* ================================================================ historial */

const HISTORY_KEY = "metroflow-history";
const PINS_KEY = "metroflow-pins";

function histKey(e: HistoryEntry): string {
  return `${e.from}>${e.to}|${e.criterion}`;
}

function loadHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as HistoryEntry[];
    return Array.isArray(parsed) ? parsed.slice(0, 40) : [];
  } catch {
    return [];
  }
}

function loadPinned(): string[] {
  try {
    const raw = localStorage.getItem(PINS_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

function persist(state: State): void {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(state.history.slice(0, 40)));
    localStorage.setItem(PINS_KEY, JSON.stringify([...state.pinned]));
  } catch {
    /* sin persistencia disponible */
  }
}

function pushHistory(state: State): void {
  if (state.from === null || state.to === null) return;
  const entry: HistoryEntry = {
    ts: Date.now(),
    from: state.from,
    to: state.to,
    criterion: state.criterion,
  };
  const key = histKey(entry);
  state.history = [entry, ...state.history.filter((e) => histKey(e) !== key)];
  persist(state);
}

/* ============================================================ URL compartible */

function syncUrl(state: State): void {
  const params = new URLSearchParams();
  if (state.from !== null) params.set("o", String(state.from));
  if (state.to !== null) params.set("d", String(state.to));
  params.set("c", state.criterion);
  params.set("v", state.kind);
  if (state.mode !== "plan") params.set("m", state.mode);
  if (state.closed.size > 0) {
    params.set("x", [...state.closed].map((k) => k.replace(":", "-")).join(","));
  }
  const qs = params.toString();
  history.replaceState(null, "", `${location.pathname}${qs ? `?${qs}` : ""}`);
}

function readUrl(state: State): void {
  const params = new URLSearchParams(location.search);
  const n = state.graph.stationCount;
  const o = params.get("o");
  const d = params.get("d");
  if (o !== null) {
    const v = Number(o);
    if (Number.isInteger(v) && v >= 0 && v < n) state.from = v;
  }
  if (d !== null) {
    const v = Number(d);
    if (Number.isInteger(v) && v >= 0 && v < n) state.to = v;
  }
  if (params.get("c") === "hops") state.criterion = "hops";
  if (params.get("v") === "schem") state.kind = "schem";
  const m = params.get("m");
  if (m === "lab" || m === "incident") state.mode = m;
  const x = params.get("x");
  if (x) {
    for (const part of x.split(",")) {
      const [a, b] = part.split("-").map(Number);
      if (
        Number.isInteger(a) && Number.isInteger(b) &&
        a >= 0 && b >= 0 && a < n && b < n && a !== b
      ) {
        state.closed.add(tramoKey(a, b));
      }
    }
  }
}

/* ============================================================== búsqueda */

interface SearchTarget {
  state: State;
  target: "from" | "to";
  extra?: string;
  onPick?: () => void;
}

function openStationSearch(opts: SearchTarget): void {
  closeSearch();
  const { state, target } = opts;
  const opener = document.activeElement as HTMLElement | null;
  searchOpener = opener instanceof HTMLElement ? opener : null;
  const overlay = document.createElement("div");
  overlay.className = "search-overlay";
  overlay.id = "search-overlay";
  setUIHTML(overlay, `
    <div class="search-box" role="dialog" aria-modal="true" aria-label="Buscar estación">
      <div class="search-head">
        <p class="eyebrow">${target === "from" ? "Origen" : "Destino"} · búsqueda incremental</p>
        <button class="icon-btn small" type="button" data-close aria-label="Cerrar búsqueda">${icon("close", 14)}</button>
      </div>
      <input id="search-input" type="text" autocomplete="off" spellcheck="false"
        role="combobox" aria-expanded="true" aria-controls="search-results"
        aria-autocomplete="list" aria-haspopup="listbox"
        placeholder="Escribe el nombre de la estación…" aria-label="Nombre de la estación">
      ${opts.extra ? `<p class="search-note">${esc(opts.extra)}</p>` : ""}
      <ul id="search-results" class="search-results" role="listbox" aria-label="Resultados"></ul>
      <p class="sr-only" id="search-count" aria-live="polite"></p>
    </div>`);
  app.appendChild(overlay);

  const input = overlay.querySelector<HTMLInputElement>("#search-input")!;
  const list = overlay.querySelector<HTMLElement>("#search-results")!;
  const counter = overlay.querySelector<HTMLElement>("#search-count")!;
  let options: Station[] = state.graph.stations.slice();
  let cursor = 0;

  const renderOptions = () => {
    // aria-activedescendant: el foco permanece en el input y el lector de
    // pantalla anuncia la opción activa de la lista.
    if (options.length === 0) {
      input.removeAttribute("aria-activedescendant");
      setUIHTML(list, `<li class="search-empty" role="status">Sin coincidencias.</li>`);
      return;
    }
    const cursorId = `search-opt-${options[cursor].id}`;
    input.setAttribute("aria-activedescendant", cursorId);
    setUIHTML(list, options
      .map(
        (s, i) => `<li role="option" id="search-opt-${s.id}" aria-selected="${i === cursor}" class="search-option${i === cursor ? " active" : ""}" data-id="${s.id}">
          <span class="so-name">${esc(s.name)}</span>
          <span class="so-meta">${esc(s.municipio)} · ${s.lines.map(esc).join(" ")}</span>
        </li>`,
      )
      .join(""));
  };

  const refill = () => {
    const q = normalize(input.value.trim());
    const all = state.graph.stations.slice().sort((a, b) =>
      a.name.localeCompare(b.name, "es"),
    );
    options =
      q === ""
        ? all
        : all.filter(
            (s) =>
              normalize(s.name).includes(q) || normalize(s.municipio).includes(q),
          );
    cursor = 0;
    renderOptions();
    counter.textContent =
      options.length === 0
        ? "Sin coincidencias para la búsqueda."
        : `${options.length} de ${state.graph.stations.length} estaciones coinciden.`;
  };

  const pick = (id: number) => {
    if (target === "from") {
      state.from = id;
      if (state.to === id) state.to = null;
    } else {
      state.to = id;
      if (state.from === id) state.from = null;
    }
    closeSearch();
    void afterEndpoints(state);
  };

  const moveCursor = (delta: number) => {
    if (options.length === 0) return;
    cursor = (cursor + delta + options.length) % options.length;
    renderOptions();
  };

  const setCursor = (index: number) => {
    cursor = index;
    renderOptions();
  };

  // El cuadro de diálogo es modal: Tab no puede escapar a la página de fondo.
  // Los únicos controles enfocables son el campo y el botón de cerrar; las
  // opciones se seleccionan con ArrowDown/Up + Enter (patrón combobox).
  overlay.addEventListener("keydown", (event) => {
    if (event.key !== "Tab") return;
    const focusables = Array.from(
      overlay.querySelectorAll<HTMLElement>("input, button"),
    ).filter((el) => !el.hasAttribute("disabled"));
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  input.addEventListener("input", refill);
  input.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveCursor(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      moveCursor(-1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const s = options[cursor];
      if (s) pick(s.id);
    } else if (event.key === "Escape") {
      event.preventDefault();
      closeSearch();
    }
  });
  list.addEventListener("mousemove", (event) => {
    const li = (event.target as HTMLElement).closest<HTMLElement>("[data-id]");
    if (li) {
      const idx = options.findIndex((s) => String(s.id) === li.dataset.id);
      if (idx >= 0 && idx !== cursor) setCursor(idx);
    }
  });
  list.addEventListener("click", (event) => {
    const li = (event.target as HTMLElement).closest<HTMLElement>("[data-id]");
    if (li) pick(Number(li.dataset.id));
  });
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) closeSearch();
  });
  overlay.querySelector("[data-close]")?.addEventListener("click", closeSearch);

  refill();
  input.focus();
}

/**
 * Guardia del elemento que abrió el buscador: al cerrarlo se devuelve el foco
 * al abridor (patrón de diálogo modal) para que el flujo de Tab/lectores de
 * pantalla continúe donde empezó.
 */
let searchOpener: HTMLElement | null = null;
function closeSearch(): void {
  const overlay = document.getElementById("search-overlay");
  overlay?.remove();
  searchOpener?.focus();
  searchOpener = null;
}

/* ==================================================================== shell */

function renderShell(state: State): void {
  const theme = currentTheme();
  setUIHTML(app, `
    <a class="skip-link" href="#side">Saltar al panel</a>
    <header class="site-header">
      <div class="header-inner">
        <div class="brand">
          <span class="monogram" aria-hidden="true">MF</span>
          <div class="brand-text">
            <h1 class="brand-name">MetroFlow</h1>
            <p class="brand-sub">Red de transporte · Valle de Aburrá</p>
          </div>
        </div>
        <nav class="mode-tabs" aria-label="Experiencias de la aplicación">
          <button class="mode-tab" type="button" data-mode="plan">Planificador</button>
          <button class="mode-tab" type="button" data-mode="lab">Laboratorio</button>
          <button class="mode-tab" type="button" data-mode="incident">Incidencias</button>
        </nav>
        <button id="search-global" class="btn ghost find-btn" type="button" title="Buscar estación (Ctrl+K)">
          ${icon("search", 14)} <kbd>Ctrl K</kbd>
        </button>
        <button id="theme-toggle" class="icon-btn" type="button" aria-pressed="${theme === "dark"}">
          <span class="theme-icon">${icon(theme === "dark" ? "sun" : "moon")}</span>
          <span class="sr-only">Cambiar tema</span>
        </button>
      </div>
    </header>

    <main class="layout" data-mode="${state.mode}">
      <section class="stage" aria-label="Red de transporte">
        <div class="section-head">
          <p class="eyebrow">01 — Red</p>
          <h2 class="display" id="stage-title">La red, línea por línea</h2>
          <div class="rule" style="--rule-w:32%"></div>
        </div>
        <div class="map-shell">
          <div class="map-wrap">
            <div class="map-view-toggle" role="group" aria-label="Vista del mapa">
              <button class="view-tab" type="button" data-view="geo">Geográfico</button>
              <button class="view-tab" type="button" data-view="schem">Esquemático</button>
            </div>
            <div class="map-tools" role="group" aria-label="Controles de zoom">
              <button class="icon-btn small" type="button" data-map="in" aria-label="Acercar">${icon("plus", 16)}</button>
              <button class="icon-btn small" type="button" data-map="out" aria-label="Alejar">${icon("minus", 16)}</button>
              <button class="icon-btn small" type="button" data-map="reset" aria-label="Restablecer vista">${icon("reset", 16)}</button>
            </div>
          </div>
          <div class="map-aside">
            <p class="eyebrow">Líneas</p>
            ${renderLegend(state.graph)}
            <p class="map-hint">Haz clic en una estación para fijarla como origen o
            destino. Arrastra para mover la red, usa la rueda o los botones para acercar.
            En móvil el desplazamiento de la página queda con un dedo y el zoom del
            mapa con los botones.</p>
          </div>
        </div>
      </section>
      <aside class="side" id="side" aria-label="Panel de la experiencia" tabindex="-1"></aside>
    </main>

    <footer class="site-footer">
      <div class="footer-inner">
        <p>MetroFlow · modelo de tiempos <strong>estimado</strong>: distancia y velocidad
        comercial declarada por línea; penalización de transbordo
        ${state.graph.transferPenaltyMin.toFixed(1)} min. No son datos de operación en vivo.
        Fuente: <code>stations.json</code> (57 estaciones) y <code>connections.json</code>
        (8 líneas).</p>
        <p class="signature">Diseño y desarrollo — <span class="sig-name">samirjosegil</span></p>
      </div>
    </footer>
    <p class="sr-only" id="live-region" role="status" aria-live="polite"></p>`);

  const mapWrap = app.querySelector(".map-wrap")!;
  mapWrap.insertBefore(state.map.el, mapWrap.querySelector(".map-tools"));

  wireShell(state);
  syncSelection(state);
}

function renderLegend(graph: Graph): string {
  const items = graph.lines
    .map((line) => {
      const info = LINE_INFO[line];
      const mode = info?.mode ?? "metro";
      return `<li class="legend-item">
        <span class="legend-swatch mode-${mode}" style="--line-color:${lineColor(line)}"></span>
        <span class="legend-line">Línea ${esc(line)}</span>
        <span class="legend-name">${esc(info?.name ?? "")}</span>
      </li>`;
    })
    .join("");
  return `<ul class="legend" aria-label="Líneas de la red">${items}</ul>`;
}

function announce(state: State, message: string): void {
  const live = app.querySelector<HTMLElement>("#live-region");
  if (live) live.textContent = message;
  void state;
}

function wireShell(state: State): void {
  app.querySelectorAll<HTMLButtonElement>(".mode-tab").forEach((tab) => {
    tab.addEventListener("click", () => void setMode(state, (tab.dataset.mode as Mode) ?? "plan"));
  });
  app.querySelectorAll<HTMLButtonElement>(".view-tab").forEach((tab) => {
    tab.addEventListener("click", () => void setView(state, (tab.dataset.view as MapViewKind) ?? "geo"));
  });
  app.querySelectorAll<HTMLButtonElement>("[data-map]").forEach((button) => {
    button.addEventListener("click", () => {
      const action = button.dataset.map;
      if (action === "in") state.map.zoomIn();
      else if (action === "out") state.map.zoomOut();
      else state.map.resetZoom();
    });
  });
  app.querySelector("#theme-toggle")?.addEventListener("click", (event) => {
    const next: Theme = toggleTheme();
    const button = event.currentTarget as HTMLButtonElement;
    button.setAttribute("aria-pressed", String(next === "dark"));
    setUIHTML(
      button.querySelector(".theme-icon")!,
      icon(next === "dark" ? "sun" : "moon"),
    );
    state.map.setTheme(next);
  });
  app.querySelector("#search-global")?.addEventListener("click", () => {
    openStationSearch({
      state,
      target: state.from !== null && state.to === null ? "to" : "from",
    });
  });

  document.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      openStationSearch({
        state,
        target: state.from === null ? "from" : state.to === null ? "to" : "from",
        extra:
          state.from !== null && state.to === null
            ? "El resultado se fijará como destino."
            : state.from === null
              ? "Se fijará como origen; después se pedirá el destino."
              : "Se reemplazará el origen.",
      });
      return;
    }
    if (event.key === "Escape") closeSearch();
  });

  wireMapHandlers(state, state.map);

  syncModeTabs(state);
  syncViewTabs(state);
}

/** Conecta los clics de estación y de tramo en cualquier superficie de mapa. */
function wireMapHandlers(state: State, map: MapSurface): void {
  map.onStationClick((id) => {
    if (state.from === null) {
      state.from = id;
    } else if (state.to !== null) {
      state.from = id;
      state.to = null;
    } else {
      state.to = id;
    }
    void afterEndpoints(state);
  });
  map.onEdgeClick((edge) => toggleClosedFromMap(state, edge.from, edge.to));
}

function toggleClosedFromMap(state: State, a: number, b: number): void {
  if (!state.edgeClickActive) return;
  const key = tramoKey(a, b);
  if (state.closed.has(key)) state.closed.delete(key);
  else state.closed.add(key);
  state.map.setClosedEdges(closedIds(state));
  syncUrl(state);
  renderSide(state);
  void runIncident(state);
}

/* ------------------------------------------------------- selección endpoints */

function syncSelection(state: State): void {
  state.map.setEndpoint(state.from, "origin");
  state.map.setEndpoint(state.to, "destination");
}

/**
 * Las marcas de tramo cerrado solo describen el escenario del simulador de
 * incidencias. En Planificador y Laboratorio el evento se calcula sobre la red
 * completa, así que el mapa no debe mostrar marcas que no aplican (fidelidad
 * visual: lo que se ve dibujado es lo que el motor usó).
 */
function syncClosedMarks(state: State): void {
  state.map.setClosedEdges(state.mode === "incident" ? closedIds(state) : []);
}

/* ------------------------------------------------------------------- modos */

function syncModeTabs(state: State): void {
  app.querySelectorAll<HTMLButtonElement>(".mode-tab").forEach((tab) => {
    const active = tab.dataset.mode === state.mode;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-current", active ? "page" : "false");
  });
  const layout = app.querySelector<HTMLElement>(".layout");
  if (layout) layout.dataset.mode = state.mode;
  const title = app.querySelector<HTMLElement>("#stage-title");
  if (title) {
    title.textContent =
      state.mode === "lab"
        ? "El algoritmo, paso a paso"
        : state.mode === "incident"
          ? "Cierres de tramo y su impacto"
          : "La red, línea por línea";
  }
}

function syncViewTabs(state: State): void {
  app.querySelectorAll<HTMLButtonElement>(".view-tab").forEach((tab) => {
    const active = tab.dataset.view === state.kind;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-pressed", String(active));
  });
  app.querySelector(".layout")?.setAttribute("data-view", state.kind);
}

async function setMode(state: State, mode: Mode): Promise<void> {
  if (state.mode !== mode) {
    state.mode = mode;
    state.edgeClickActive = mode === "incident";
    if (mode !== "lab") state.lab?.destroy(), (state.lab = null);
    syncClosedMarks(state);
    syncModeTabs(state);
    renderSide(state);
    syncUrl(state);
  }
  if (state.mode === "lab") await runLab(state);
}

async function setView(state: State, kind: MapViewKind): Promise<void> {
  if (state.kind === kind) return;
  state.kind = kind;
  state.map.clearExplore();
  state.map.clearClosed();
  const fallback = new MapView(state.graph, kind);
  state.map.destroy();
  state.map.el.replaceWith(fallback.el);
  state.map = fallback;
  const next = await createMapSurface(
    state.graph,
    kind,
    currentTheme(),
    fallback,
  );
  if (next !== fallback) state.map = next;
  wireMapHandlers(state, next);

  syncSelection(state);
  state.map.setActiveRoute(state.activeRoute);
  state.map.setClosedEdges(state.mode === "incident" ? closedIds(state) : []);
  if (state.lab) state.lab.goto(0, false, true);
  else state.map.clearExplore();
  syncViewTabs(state);
  syncUrl(state);
}

/* --------------------------------------------------------------- viajeros */

function journeyCardHTML(state: State, context: string): string {
  return `
    <div class="panel journey">
      <div class="panel-head">
        <p class="eyebrow">${esc(context)}</p>
      </div>
      <div class="journey-row">
        <button class="journey-station" type="button" data-journey="from" aria-label="Cambiar origen">
          <span class="j-label">Origen</span>
          <span class="j-name">${esc(stationLabel(state, state.from))}</span>
        </button>
        <span class="j-arrow">${icon("arrow", 14)}</span>
        <button class="journey-station" type="button" data-journey="to" aria-label="Cambiar destino">
          <span class="j-label">Destino</span>
          <span class="j-name">${esc(stationLabel(state, state.to))}</span>
        </button>
      </div>
      <fieldset class="criterion journey-criterion">
        <legend>Criterio de optimización</legend>
        <label class="seg"><input type="radio" name="criterion-mode" data-criterion-mode="time" ${state.criterion === "time" ? "checked" : ""}><span>Menor tiempo</span></label>
        <label class="seg"><input type="radio" name="criterion-mode" data-criterion-mode="hops" ${state.criterion === "hops" ? "checked" : ""}><span>Menos paradas</span></label>
      </fieldset>
      <button data-switch-plan class="btn ghost small" type="button">${icon("route", 14)} Editar el viaje en el planificador</button>
    </div>`;
}

function wireJourney(state: State, root: HTMLElement, onChange: () => void): void {
  root.querySelectorAll<HTMLButtonElement>("[data-journey]").forEach((btn) => {
    btn.addEventListener("click", () => {
      openStationSearch({
        state,
        target: btn.dataset.journey === "from" ? "from" : "to",
      });
    });
  });
  root.querySelectorAll<HTMLInputElement>("input[data-criterion-mode]").forEach((el) => {
    el.addEventListener("change", () => {
      if (!el.checked) return;
      state.criterion = (el.dataset.criterionMode as Criterion) ?? "time";
      syncUrl(state);
      onChange();
    });
  });
  root.querySelector("[data-switch-plan]")?.addEventListener("click", () => {
    void setMode(state, "plan");
  });
}

/* ================================================================= lado plan */

function renderSide(state: State): void {
  const side = app.querySelector<HTMLElement>("#side");
  if (!side) return;
  if (state.mode === "plan") {
    setUIHTML(side, planSideHTML(state));
    wirePlanSide(state, side);
  } else if (state.mode === "lab") {
    setUIHTML(side, `
      <div class="results">
        ${journeyCardHTML(state, "02 — Laboratorio")}
        <section class="panel lab-partner">
          <p class="eyebrow">03 — Traza</p>
          <div id="lab-mount" aria-label="Ejecución paso a paso"></div>
        </section>
      </div>`);
    wireJourney(state, side, () => void runLab(state));
  } else {
    setUIHTML(side, incidentSideHTML(state));
    wireIncidentSide(state, side);
  }
}

function planSideHTML(state: State): string {
  return `
    <section class="panel planner" id="planner">
      <div class="panel-head">
        <p class="eyebrow">02 — Viaje</p>
        <h2>Planifica un recorrido</h2>
      </div>
      <form id="planner-form" novalidate>
        <div class="field">
          <span class="field-label" id="lbl-from">Origen</span>
          <button id="from-btn" class="j-station-select" type="button" aria-labelledby="lbl-from">
            <span class="jp-dot" aria-hidden="true"></span>
            <span class="j-name">${state.from !== null ? esc(stationLabel(state, state.from)) : "Buscar una estación"}</span>
          </button>
          <span class="sr-only" id="lbl-from-label">${state.from !== null ? esc(stationLabel(state, state.from)) : "Sin origen"}</span>
        </div>
        <div class="swap-row">
          <button id="swap" class="btn ghost small" type="button">${icon("swap", 16)} Invertir</button>
        </div>
        <div class="field">
          <span class="field-label" id="lbl-to">Destino</span>
          <button id="to-btn" class="j-station-select" type="button" aria-labelledby="lbl-to">
            <span class="jp-dot dest" aria-hidden="true"></span>
            <span class="j-name">${state.to !== null ? esc(stationLabel(state, state.to)) : "Buscar una estación"}</span>
          </button>
          <span class="sr-only" id="lbl-to-label">${state.to !== null ? esc(stationLabel(state, state.to)) : "Sin destino"}</span>
        </div>
        <fieldset class="criterion">
          <legend>Criterio de optimización</legend>
          <label class="seg"><input type="radio" name="criterion" value="time" ${state.criterion === "time" ? "checked" : ""}><span>${icon("clock", 14)} Menor tiempo</span></label>
          <label class="seg"><input type="radio" name="criterion" value="hops" ${state.criterion === "hops" ? "checked" : ""}><span>${icon("route", 14)} Menos paradas</span></label>
        </fieldset>
        <div class="actions">
          <button id="btn-calc" class="btn primary" type="submit">${icon("route", 16)} Calcular</button>
          <button id="btn-compare" class="btn" type="button">${icon("compare", 16)} Comparar</button>
          <button id="btn-lab" class="btn" type="button">${icon("spark", 16)} Paso a paso</button>
        </div>
        <p class="hint" id="planner-hint">Elige origen y destino con el buscador (Ctrl+K) o
        haz clic en dos estaciones del mapa.</p>
      </form>
    </section>
    <section id="results" class="results" aria-live="polite">
      ${planResultsInline(state)}
    </section>`;
}

function planResultsInline(state: State): string {
  if (!state.lastPlan || !state.lastPlan.found) return "";
  const route = state.lastPlan;
  const title =
    state.criterion === "time" ? "Ruta más rápida" : "Ruta con menos paradas";
  const criterionLabel =
    state.criterion === "time"
      ? "menor tiempo (Dijkstra sobre estados)"
      : "menos paradas (BFS)";
  return (
    routeDetailHTML(state, route, title, `Ruta · ${criterionLabel}`) +
    foldHTML("Rutas alternativas", alternativesHTML(state)) +
    foldHTML("Historial local", historyHTML(state))
  );
}

function wirePlanSide(state: State, root: HTMLElement): void {
  root.querySelector<HTMLFormElement>("#planner-form")?.addEventListener(
    "submit",
    (event) => {
      event.preventDefault();
      void runPlan(state, "calc");
    },
  );
  root.querySelector("#from-btn")?.addEventListener("click", () => {
    openStationSearch({ state, target: "from" });
  });
  root.querySelector("#to-btn")?.addEventListener("click", () => {
    openStationSearch({ state, target: "to" });
  });
  root.querySelector("#swap")?.addEventListener("click", () => {
    const from = state.from;
    state.from = state.to;
    state.to = from;
    renderSide(state);
    void runPlan(state, "calc");
  });
  root.querySelectorAll<HTMLInputElement>('input[name="criterion"]').forEach((el) => {
    el.addEventListener("change", () => {
      if (el.checked) state.criterion = el.value as Criterion;
      syncUrl(state);
      if (state.lastPlan) void runPlan(state, "calc");
    });
  });
  root.querySelector("#btn-compare")?.addEventListener("click", () => void runPlan(state, "compare"));
  root.querySelector("#btn-lab")?.addEventListener("click", () => {
    void setMode(state, "lab");
  });
  wireResults(state, root);
  wireHistory(state);
}

/* ---------------------------------------------------------------------------
   Resultados compartidos (plan / comparación)
--------------------------------------------------------------------------- */

function wireResults(state: State, root: HTMLElement): void {
  root.querySelectorAll<HTMLButtonElement>("[data-alt]").forEach((button) => {
    button.addEventListener("click", () => {
      selectAlternative(state, Number(button.dataset.alt));
    });
  });
  root.querySelector<HTMLButtonElement>("#btn-export")?.addEventListener(
    "click",
    () => void doExport(state, root),
  );
  root.querySelector<HTMLButtonElement>("#btn-probe")?.addEventListener("click", () => {
    void setMode(state, "incident");
  });
}

function selectAlternative(state: State, index: number): void {
  const route = state.alternatives[index];
  if (!route) return;
  state.activeIndex = index;
  state.activeRoute = route;
  state.exportParams = {
    from: state.from!,
    to: state.to!,
    criterion: "time",
    k: state.alternatives.length,
    index,
  };
  state.map.setActiveRoute(route);
  const results = app.querySelector<HTMLElement>("#results")!;
  results.querySelectorAll<HTMLButtonElement>("[data-alt]").forEach((button) => {
    const current = Number(button.dataset.alt) === index;
    button.classList.toggle("current", current);
    button.setAttribute("aria-current", String(current));
  });
  const detail = results.querySelector<HTMLElement>(".result-panel");
  if (detail) {
    const replacement = document.createElement("div");
    setUIHTML(replacement, routeDetailHTML(
      state,
      route,
      `Ruta alternativa ${String(index + 1).padStart(2, "0")}`,
      "Ruta · alternativa",
    ));
    detail.replaceWith(replacement.firstElementChild!);
    wireResults(state, results);
  }
}

function metricsBlock(route: Route): string {
  return `<div class="metrics">
    <div class="metric">
      <span class="metric-value">${route.totalMin.toFixed(1)}</span>
      <span class="metric-unit">min</span>
      <span class="metric-label">Tiempo estimado</span>
    </div>
    <div class="metric">
      <span class="metric-value">${route.totalKm.toFixed(2)}</span>
      <span class="metric-unit">km</span>
      <span class="metric-label">Distancia</span>
    </div>
    <div class="metric">
      <span class="metric-value">${route.stops}</span>
      <span class="metric-label">Paradas</span>
    </div>
    <div class="metric">
      <span class="metric-value">${route.transfers}</span>
      <span class="metric-label">Transbordos</span>
    </div>
  </div>`;
}

function legsBlock(route: Route): string {
  const rows = route.legs
    .map((leg, index) => {
      const color = lineColor(leg.line);
      return `<li class="leg" style="--i:${index};--line-color:${color}">
        <span class="leg-badge">${esc(leg.line)}</span>
        <div class="leg-body">
          <span class="leg-path">${esc(leg.fromName)} <span class="arrow" aria-hidden="true">→</span> ${esc(leg.toName)}</span>
          <span class="leg-meta">${lineName(leg.line)} · ${leg.timeMin.toFixed(1)} min · ${leg.distanceKm.toFixed(2)} km</span>
        </div>
      </li>`;
    })
    .join("");
  return `<ol class="legs">${rows}</ol>`;
}

function exportActions(state: State): string {
  const withScenario = state.closed.size > 0 && state.mode === "incident";
  const note = withScenario
    ? `<span class="hint-inline">Incluye el escenario actual (incidencias).</span>`
    : "";
  return `<div class="result-actions">
      <button data-export class="btn ghost" type="button">${icon("download", 16)} Exportar grafo + ruta</button>
      <span data-export-status class="status" role="status"></span>
      ${note}
    </div>`;
}

function textualBlock(route: Route): string {
  const items = route.stations
    .map(
      (s, i) =>
        `<li>${esc(s.name)}${i === 0 ? " — origen" : i === route.stations.length - 1 ? " — destino" : ""}</li>`,
    )
    .join("");
  const legsText = route.legs
    .map(
      (leg) =>
        `${leg.fromName} → ${leg.toName} · línea ${leg.line} · ${leg.timeMin.toFixed(1)} min · ${leg.distanceKm.toFixed(2)} km`,
    )
    .join("; ");
  return `<details class="textual">
    <summary>${icon("list", 14)} Vista textual: secuencia de estaciones</summary>
    <ol class="textual-stations">${items}</ol>
    <p class="textual-legs">${esc(legsText)}</p>
    <p class="textual-total">Total: ${route.totalMin.toFixed(1)} min · ${route.totalKm.toFixed(2)} km · ${route.stops} paradas · ${route.transfers} transbordos.</p>
  </details>`;
}

function routeDetailHTML(
  state: State,
  route: Route,
  title: string,
  eyebrow: string,
  withActions = true,
): string {
  return `<section class="panel result-panel">
    <div class="panel-head">
      <p class="eyebrow">${esc(eyebrow)}</p>
      <h3>${esc(title)}</h3>
      <p class="route-ends">${esc(stationLabel(state, state.from))} <span class="arrow" aria-hidden="true">→</span> ${esc(stationLabel(state, state.to))}</p>
    </div>
    ${metricsBlock(route)}
    ${legsBlock(route)}
    ${textualBlock(route)}
    ${withActions
      ? `${exportActions(state)}
         <div class="result-actions secondary">
           <button data-probe class="btn ghost small" type="button">${icon("zap", 14)} Probar una incidencia sobre esta ruta</button>
         </div>`
      : ""}
  </section>`;
}

function alternativesHTML(state: State): string {
  if (state.alternatives.length === 0) return "";
  const cards = state.alternatives
    .map((route, index) => {
      const lines = route.legs.map((l) => l.line);
      const current = index === state.activeIndex;
      return `<li>
        <button class="alt-card${current ? " current" : ""}" type="button" data-alt="${index}" aria-current="${current}">
          <span class="alt-rank">Ruta ${String(index + 1).padStart(2, "0")}</span>
          <span class="alt-metrics">${route.totalMin.toFixed(1)} min · ${route.stops} paradas · ${route.transfers} transbordos · ${route.totalKm.toFixed(2)} km</span>
          <span class="alt-lines">${lineBadges(lines)}</span>
        </button>
      </li>`;
    })
    .join("");
  const note =
    state.criterion === "hops"
      ? `Aproximación de Yen: las alternativas se ordenan siempre por tiempo
      (incluye la penalización de transbordo), aunque el planificador esté en
      modo «menos paradas». No se garantiza que sean óptimas bajo ese criterio.`
      : `Aproximación de Yen: se ordenan por tiempo incluyendo la
      penalización de transbordo. No se garantiza que sean óptimas bajo ese mismo criterio.`;
  return `<section class="panel alternatives">
    <div class="panel-head">
      <p class="eyebrow">03 — Opciones</p>
      <h3>Rutas alternativas</h3>
    </div>
    <p class="alt-note">${note}</p>
    <ul class="alt-list">${cards}</ul>
  </section>`;
}

function lineBadges(lines: string[]): string {
  const unique = [...new Set(lines)];
  return unique
    .map(
      (l) =>
        `<span class="line-badge" style="--line-color:${lineColor(l)}">${esc(l)}</span>`,
    )
    .join("");
}

function warn(message: string, iconName = "alert"): string {
  return `<section class="panel state-panel">${icon(iconName, 20)}<p>${esc(message)}</p></section>`;
}

function loadingBlock(label: string): string {
  return `<section class="panel state-panel loading"><span class="spinner" aria-hidden="true"></span><p>${esc(label)}</p></section>`;
}

/* -------------------------------------------------------------- ejecuciones */

async function afterEndpoints(state: State): Promise<void> {
  syncSelection(state);
  renderSide(state);
  syncUrl(state);
  if (
    state.mode === "plan" &&
    state.from !== null && state.to !== null && state.from !== state.to
  ) {
    await runPlan(state, "calc");
  }
}

async function runPlan(state: State, mode: "calc" | "compare"): Promise<void> {
  // El Planificador nunca usa el escenario de incidencias: sin marcas en el mapa.
  if (state.mode !== "plan") await setMode(state, "plan");
  syncClosedMarks(state);
  const results = app.querySelector<HTMLElement>("#results");
  if (!results) return;
  state.lab?.destroy();
  state.lab = null;
  state.map.clearExplore();
  if (state.from === null || state.to === null) {
    setUIHTML(results, warn("Selecciona un origen y un destino para calcular la ruta."));
    return;
  }
  if (state.from === state.to) {
    setUIHTML(results, warn("El origen y el destino son la misma estación."));
    return;
  }

  const runId = ++state.runId;
  try {
    if (mode === "calc") {
      setUIHTML(results, loadingBlock("Calculando la ruta…"));
      const route = await api.route({
        from: state.from,
        to: state.to,
        criterion: state.criterion,
      });
      if (runId !== state.runId) return;
      if (!route.found) {
        state.map.clearActiveRoute();
        state.activeRoute = null;
        state.exportParams = null;
        state.lastPlan = null;
        setUIHTML(results, warn("No existe una ruta disponible entre esas estaciones."));
        announce(state, "No existe una ruta disponible entre esas estaciones.");
        return;
      }
      let alternatives: Route[] = [];
      try {
        alternatives = await api.alternatives(state.from, state.to);
      } catch {
        alternatives = [];
      }
      if (runId !== state.runId) return;

      state.lastPlan = route;
      state.alternatives = alternatives;
      state.activeIndex = 0;
      state.activeRoute = route;
      state.exportParams =
        state.criterion === "time"
          ? {
              from: state.from,
              to: state.to,
              criterion: "time",
              k: Math.max(alternatives.length, 1),
              index: 0,
            }
          : { from: state.from, to: state.to, criterion: "hops" };
      state.map.setActiveRoute(route);
      renderPlanResults(state);
      pushHistory(state);
      announce(
        state,
        `Ruta calculada: ${route.totalMin.toFixed(1)} minutos, ${route.stops} paradas.`,
      );
    } else {
      setUIHTML(results, loadingBlock("Comparando criterios…"));
      const [fast, few] = await Promise.all([
        api.route({ from: state.from, to: state.to, criterion: "time" }),
        api.route({ from: state.from, to: state.to, criterion: "hops" }),
      ]);
      if (runId !== state.runId) return;
      state.comparison = { original: fast, scenario: few };
      state.activeRoute = fast;
      state.exportParams = { from: state.from, to: state.to, criterion: "time" };
      state.map.setActiveRoute(fast);
      const left = fast.found
        ? routeDetailHTML(state, fast, "Dijkstra · menor tiempo", "Criterio A", false)
        : warn("Sin ruta por tiempo.");
      const right = few.found
        ? routeDetailHTML(state, few, "BFS · menos paradas", "Criterio B", false)
        : warn("Sin ruta por paradas.");
      setUIHTML(results, `<div class="compare">${left}${right}</div>${exportActions(state)}`);
      wireResults(state, results);
    }
  } catch (error) {
    if (runId !== state.runId) return;
    setUIHTML(results, warn(`Ocurrió un error al contactar la API: ${String(error)}`));
  }
}

function planResultsHTML(state: State, route: Route): string {
  const title =
    state.criterion === "time" ? "Ruta más rápida" : "Ruta con menos paradas";
  const criterionLabel =
    state.criterion === "time"
      ? "menor tiempo (Dijkstra sobre estados)"
      : "menos paradas (BFS)";
  // La ruta es el resultado principal (siempre visible); las alternativas y el
  // historial son secundarios y se pliegan para no alargar la columna.
  return (
    routeDetailHTML(state, route, title, `Ruta · ${criterionLabel}`) +
    foldHTML("Rutas alternativas", alternativesHTML(state)) +
    foldHTML("Historial local", historyHTML(state))
  );
}

/** Sección plegable: mantiene el panel corto sin esconder el contenido. */
function foldHTML(summary: string, content: string): string {
  if (!content) return "";
  return `<details class="fold"><summary>${esc(summary)}</summary>${content}</details>`;
}

/** Redibuja el bloque de resultados del Planificador (ruta + pliegues). */
function renderPlanResults(state: State): void {
  const results = app.querySelector<HTMLElement>("#results");
  if (!results || state.mode !== "plan" || !state.lastPlan) return;
  setUIHTML(results, planResultsHTML(state, state.lastPlan));
  wireResults(state, results);
  wireHistory(state);
}

async function doExport(state: State, root: HTMLElement): Promise<void> {
  const status = root.querySelector<HTMLElement>("[data-export-status]");
  const button = root.querySelector<HTMLButtonElement>("[data-export]");
  if (!state.exportParams) {
    if (status) status.textContent = "Nada que exportar todavía.";
    return;
  }
  if (button) button.disabled = true;
  if (status) status.textContent = "Exportando…";
  try {
    const closed = state.mode === "incident" ? closedIds(state) : undefined;
    const text = await api.exportRoute({ ...state.exportParams, closedConnections: closed });
    download("metroflow_route.json", text);
    if (status) status.textContent = "Documento descargado (metroflow_route.json).";
  } catch (error) {
    if (status) status.textContent = `Error al exportar: ${String(error)}`;
  } finally {
    if (button) button.disabled = false;
  }
}

/* ===================================================================== LAB */

async function runLab(state: State): Promise<void> {
  state.lab?.destroy();
  state.lab = null;
  state.map.clearExplore();
  const mount = app.querySelector<HTMLElement>("#lab-mount");
  if (!mount) return;
  if (state.from === null || state.to === null || state.from === state.to) {
    setUIHTML(mount, warn("Elige un origen y un destino distintos en la tarjeta de arriba."));
    return;
  }
  const labRunId = ++state.labRunId;
  setUIHTML(mount, loadingBlock("Generando la traza del algoritmo…"));
  try {
    const trace = await api.trace({
      from: state.from,
      to: state.to,
      criterion: state.criterion,
    });
    if (labRunId !== state.labRunId) return;
    const names = new Map(state.graph.stations.map((s) => [s.id, s.name] as [number, string]));
    const algorithm = algorithmOf(state.criterion);
    const input = {
      trace,
      algorithm,
      criterion: state.criterion,
      transferPenalty: state.graph.transferPenaltyMin,
      names,
      linesSummary:
        state.criterion === "time" ? "menor tiempo" : "menos paradas (saltos)",
    };
    const frames = buildFrames(input);
    state.labFrames = frames;
    state.lab = new LabController(mount, frames, input, {
      onFrame: (frame) => {
        state.map.setLabVisual({
          settled: frame.settled,
          frontier: frame.frontier,
          activeNode: frame.activeNode,
          edge: frame.edge,
          dists: frame.dists,
        });
      },
      onViewRoute: () => drawLabRoute(state, frames),
    });
    announce(state, "Traza generada: pulsa reproducir para ver el algoritmo paso a paso.");
  } catch (error) {
    if (labRunId !== state.labRunId) return;
    setUIHTML(mount, warn(`Error al obtener la traza: ${String(error)}`));
  }
}

function drawLabRoute(
  state: State,
  frames: LabFrame[],
): void {
  const built = routeFromFrames(frames);
  if (!built.found) return;
  const route: Route = {
    found: true,
    criterion: state.criterion,
    totalMin: 0,
    totalKm: 0,
    stops: Math.max(built.stationIds.length - 1, 0),
    transfers: 0,
    stations: built.stationIds.map((id) => ({
      id,
      name: stationLabel(state, id),
    })),
    legs: built.legs.map((l) => ({
      from: l.from,
      to: l.to,
      fromName: stationLabel(state, l.from),
      toName: stationLabel(state, l.to),
      line: l.line,
      timeMin: 0,
      distanceKm: 0,
      type: "travel",
    })),
  };
  state.activeRoute = route;
  state.map.setActiveRoute(route);
}

/* ================================================================= incidente */

function incidentSideHTML(state: State): string {
  const keys = [...state.closed];
  const labels = closedNames(state);
  return `
    <div class="results">
      ${journeyCardHTML(state, "02 — Simulador de incidencias")}
      <section class="panel incident">
        <div class="panel-head">
          <p class="eyebrow">03 — Escenario</p>
          <h3>Tramos cerrados</h3>
          <p class="inc-note">Haz clic sobre un tramo del mapa o sobre “+” en un tramo
          del recorrido resultante para cerrarlo. El cierre se aplica al motor mediante
          <code>closedConnections</code> (grafo de trabajo por solicitud).</p>
        </div>
        <ul class="closed-list" data-live="polite">
          ${labels.length === 0
            ? `<li class="closed-empty">Escenario original: ningún tramo cerrado.</li>`
            : keys
                .map(
                  (key, i) => `<li class="closed-item" data-key="${esc(key)}">
                    <span class="closed-name">${esc(labels[i])}</span>
                    <button class="icon-btn tiny" type="button" data-remove="${esc(key)}" aria-label="Quitar ${esc(labels[i])}">${icon("close", 12)}</button>
                  </li>`,
                )
                .join("")}
        </ul>
        <div class="inc-actions">
          <button id="inc-run" class="btn primary small" type="button" ${state.from === null || state.to === null ? "disabled" : ""}>
            ${icon("zap", 14)} Recalcular y comparar
          </button>
          <button id="inc-clear" class="btn ghost small" type="button" ${labels.length === 0 ? "disabled" : ""}>
            ${icon("reset", 14)} Vaciar escenario
          </button>
        </div>
      </section>
      <div id="incident-results" class="results inset" aria-live="polite">
        ${state.comparison ? incidentCompareHTML(state) : ""}
      </div>
    </div>`;
}

function wireIncidentSide(state: State, root: HTMLElement): void {
  wireJourney(state, root, () => {
    state.comparison = null;
    renderSide(state);
    void runIncident(state);
  });
  root.querySelectorAll<HTMLButtonElement>("[data-remove]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.closed.delete(btn.dataset.remove ?? "");
      state.map.setClosedEdges(closedIds(state));
      syncUrl(state);
      state.comparison = null;
      renderSide(state);
      void runIncident(state);
    });
  });
  root.querySelector("#inc-clear")?.addEventListener("click", () => {
    state.closed.clear();
    state.map.setClosedEdges([]);
    syncUrl(state);
    state.comparison = null;
    renderSide(state);
  });
  root.querySelector("#inc-run")?.addEventListener("click", () => void runIncident(state));
}

async function runIncident(state: State): Promise<void> {
  if (state.from === null || state.to === null) return;
  const container = app.querySelector<HTMLElement>("#incident-results");
  if (!container) return;
  const runId = ++state.runId;
  setUIHTML(container, loadingBlock("Recalculando con los cierres aplicados…"));
  const ids = closedIds(state);
  try {
    const [original, scenario] = await Promise.all([
      api.route({ from: state.from, to: state.to, criterion: state.criterion }),
      api.route({
        from: state.from,
        to: state.to,
        criterion: state.criterion,
        closedConnections: ids,
      }),
    ]);
    if (runId !== state.runId) return;
    state.comparison = { original, scenario };
    state.activeRoute = scenario.found ? scenario : original;
    state.exportParams = {
      from: state.from,
      to: state.to,
      criterion: state.criterion,
      closedConnections: ids.length > 0 ? ids : undefined,
    };
    state.map.setClosedEdges(ids);
    state.map.setActiveRoute(state.activeRoute);
    setUIHTML(container, incidentCompareHTML(state));
    container.querySelector<HTMLButtonElement>("[data-export]")?.addEventListener(
      "click",
      () => void doExport(state, container),
    );
    container.querySelectorAll<HTMLButtonElement>("[data-close-leg]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const [a, b] = (btn.dataset.closeLeg ?? "").split(":").map(Number);
        if (Number.isFinite(a) && Number.isFinite(b)) {
          state.closed.add(tramoKey(a, b));
          state.map.setClosedEdges(closedIds(state));
          syncUrl(state);
          renderSide(state);
          void runIncident(state);
        }
      });
    });
    announce(
      state,
      scenario.found
        ? `Ruta con la incidencia: ${scenario.totalMin.toFixed(1)} minutos.`
        : "Con la incidencia no existe ruta disponible.",
    );
  } catch (error) {
    if (runId !== state.runId) return;
    setUIHTML(container, warn(`Error al comparar: ${String(error)}`));
  }
}

function incidentCompareHTML(state: State): string {
  const { original, scenario } = state.comparison!;
  const names = closedNames(state);
  const header = `<section class="panel inc-scenario">
      <p class="eyebrow">Escenario evaluado</p>
      <ul class="closed-list compact">${names.length === 0
        ? `<li class="closed-empty">Ningún tramo cerrado (escenario original).</li>`
        : names
            .map(
              (n) =>
                `<li class="closed-item"><span class="closed-name">${esc(n)}</span></li>`,
            )
            .join("")}
      </ul>
    </section>`;

  if (!original.found) {
    return header + warn("La ruta original no existe: revisa el origen y el destino.");
  }
  if (!scenario.found) {
    return header + `<section class="panel inc-fail">
      ${icon("alert", 22)}
      <div>
        <h3>Sin ruta disponible</h3>
        <p>Al cerrar ${names.length === 1 ? "el tramo" : "los tramos"} ${esc(names.join(", "))}
        la red queda desconectada entre el origen y el destino; no hay desvío posible.</p>
        <p class="hint">El motor descartó la ruta al no existir camino con los tramos cerrados.</p>
      </div>
    </section>`;
  }

  const dMin = scenario.totalMin - original.totalMin;
  const dKm = scenario.totalKm - original.totalKm;
  const dStops = scenario.stops - original.stops;
  const dTr = scenario.transfers - original.transfers;
  const changed = original.stations.map((s) => s.id).join(",") !==
    scenario.stations.map((s) => s.id).join(",");
  const detour = changed
    ? `La incidencia obliga a un desvío: la ruta recalculada ${
        dStops === 0
          ? "usa la misma cantidad de paradas"
          : dStops > 0
            ? `agrega ${dStops} parada(s)`
            : `usa ${Math.abs(dStops)} parada(s) menos`
      }${dTr !== 0 ? ` y ${dTr > 0 ? "añade" : "reduce"} ${Math.abs(dTr)} transbordo(s)` : ""}.`
    : "La ruta no cambia con esta incidencia: el tramo cerrado no afecta al recorrido.";

  const delta = (value: number, decimals: number, unit: string): string => {
    if (Math.abs(value) < 1e-9) return `<span class="delta mono">0${unit}</span>`;
    const cls = value > 0 ? " worse" : " better";
    return `<span class="delta mono${cls}">${value > 0 ? "+" : ""}${value.toFixed(decimals)}${unit}</span>`;
  };

  return header + `
  <section class="panel inc-compare">
    <div class="panel-head">
      <p class="eyebrow">04 — Impacto</p>
      <h3>Original vs escenario con la incidencia</h3>
      <p class="inc-detour">${esc(detour)}</p>
    </div>
    ${metricsBlock(scenario)}
    <dl class="inc-deltas">
      <div><dt>Δ tiempo</dt><dd>${delta(dMin, 1, " min")}</dd></div>
      <div><dt>Δ distancia</dt><dd>${delta(dKm, 2, " km")}</dd></div>
      <div><dt>Δ paradas</dt><dd>${delta(dStops, 0, "")}</dd></div>
      <div><dt>Δ transbordos</dt><dd>${delta(dTr, 0, "")}</dd></div>
    </dl>
    <div class="compare inset">
      <div>
        <p class="eyebrow">Original</p>
        ${compactLegs(original.legs, false)}
      </div>
      <div>
        <p class="eyebrow">Con la incidencia</p>
        ${compactLegs(scenario.legs, true)}
      </div>
    </div>
    ${exportActions(state)}
  </section>`;
}

function compactLegs(legs: Route["legs"], closeable: boolean): string {
  return `<ol class="legs compact-legs">${(legs ?? [])
    .map(
      (leg) =>
        `<li class="leg"><span class="leg-badge">${esc(leg.line)}</span>
        <div class="leg-body"><span class="leg-path">${esc(leg.fromName)} → ${esc(leg.toName)}</span>
        <span class="leg-meta">${leg.timeMin.toFixed(1)} min</span></div>
        ${closeable
          ? `<button class="icon-btn tiny" type="button" data-close-leg="${esc(tramoKey(leg.from, leg.to))}" aria-label="Cerrar el tramo ${esc(leg.fromName)} ↔ ${esc(leg.toName)}" title="Cerrar este tramo">${icon("plus", 12)}</button>`
          : ""}
        </li>`,
    )
    .join("")}</ol>`;
}

/* ---------------------------------------------------------------- historia */

function historyHTML(state: State): string {
  if (state.history.length === 0) return "";
  const pinned = state.pinned;
  const sorted = state.history
    .map((e, i) => ({ e, i }))
    .sort((a, b) => {
      const pa = pinned.has(histKey(a.e)) ? 0 : 1;
      const pb = pinned.has(histKey(b.e)) ? 0 : 1;
      return pa - pb || b.e.ts - a.e.ts;
    });
  const rows = sorted
    .slice(0, 8)
    .map(({ e }) => {
      const key = histKey(e);
      const isPinned = pinned.has(key);
      return `<li class="hist-item${isPinned ? " pinned" : ""}" data-pinned="${isPinned}">
        <button class="hist-go" type="button" data-hist-go='${esc(JSON.stringify(e))}' data-hist-go-key="${esc(key)}">
          <span class="hist-route">${esc(stationLabel(state, e.from))} → ${esc(stationLabel(state, e.to))}</span>
          <span class="hist-meta">${e.criterion === "time" ? "Tiempo" : "Paradas"}</span>
        </button>
        <button class="icon-btn tiny" type="button" data-hist-pin="${esc(key)}" aria-pressed="${isPinned}" aria-label="${isPinned ? "Quitar de favoritos" : "Fijar como favorito"}" title="Fijar/aflojar">${icon("pin", 12)}</button>
        <button class="icon-btn tiny" type="button" data-hist-del="${esc(key)}" aria-label="Borrar del historial" title="Borrar">${icon("trash", 12)}</button>
      </li>`;
    })
    .join("");
  return `<section class="panel history">
    <div class="panel-head">
      <p class="eyebrow">Historial local</p>
      <h3>Rutas recientes y favoritas</h3>
    </div>
    <ul class="hist-list">${rows}</ul>
    <div class="hist-actions">
      <button id="hist-clear" class="btn ghost small" type="button">${icon("trash", 12)} Borrar historial</button>
    </div>
  </section>`;
}

function wireHistory(state: State): void {
  app.querySelectorAll<HTMLButtonElement>("[data-hist-go]").forEach((btn) => {
    btn.addEventListener("click", () => {
      try {
        const e = JSON.parse(btn.dataset.histGo ?? "{}") as HistoryEntry;
        // Los datos vienen de localStorage: se validan contra el grafo actual
        // porque los identificadores pueden haber cambiado entre sesiones.
        const n = state.graph.stationCount;
        const valid =
          Number.isInteger(e.from) && e.from >= 0 && e.from < n &&
          Number.isInteger(e.to) && e.to >= 0 && e.to < n &&
          (e.criterion === "time" || e.criterion === "hops") &&
          histKey(e) === btn.dataset.histGoKey;
        if (!valid) return;
        state.from = e.from;
        state.to = e.to;
        state.criterion = e.criterion;
        void afterEndpoints(state);
      } catch {
        /* dato corrupto: se ignora */
      }
    });
  });
  app.querySelectorAll<HTMLButtonElement>("[data-hist-pin]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.histPin ?? "";
      if (state.pinned.has(key)) state.pinned.delete(key);
      else state.pinned.add(key);
      persist(state);
      refreshHistoryPanel(state);
    });
  });
  app.querySelectorAll<HTMLButtonElement>("[data-hist-del]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.histDel ?? "";
      state.history = state.history.filter((e) => histKey(e) !== key);
      persist(state);
      refreshHistoryPanel(state);
    });
  });
  app.querySelector("#hist-clear")?.addEventListener("click", () => {
    state.history = [];
    state.pinned.clear();
    persist(state);
    refreshHistoryPanel(state);
  });
}

function refreshHistoryPanel(state: State): void {
  // El historial vive plegado dentro de los resultados: se redibuja todo el
  // bloque para mantener ruta, alternativas e historial coherentes.
  renderPlanResults(state);
}

/* ================================================================ arranque */

async function init(): Promise<void> {
  applyTheme(resolveInitialTheme());
  setUIHTML(app, `<div class="boot"><p class="boot-mark">MetroFlow</p><p class="boot-note">Cargando la red de transporte…</p></div>`);
  try {
    const graph = await api.graph();
    const state: State = {
      graph,
      map: null as unknown as MapView,
      kind: "geo",
      mode: "plan",
      from: null,
      to: null,
      criterion: "time",
      runId: 0,
      labRunId: 0,
      lastPlan: null,
      alternatives: [],
      activeIndex: 0,
      activeRoute: null,
      exportParams: null,
      lab: null,
      labFrames: null,
      edgeClickActive: false,
      closed: new Set(),
      comparison: null,
      history: loadHistory(),
      pinned: new Set(loadPinned()),
    };
    readUrl(state);
    const fallback = new MapView(graph, state.kind);
    state.map = fallback;
    try {
      syncClosedMarks(state);
    } catch {
      state.closed.clear();
    }
    renderShell(state);
    renderSide(state);
    syncViewTabs(state);
    wireHistory(state);
    state.edgeClickActive = state.mode === "incident";
    // La vista geográfica usa MapLibre cuando hay red/WebGL; si no, se queda
    // con el SVG geográfico determinista (fallback offline).
    if (state.kind === "geo") {
      const upgraded = await createMapSurface(
        graph,
        "geo",
        currentTheme(),
        fallback,
      );
      if (upgraded !== fallback) {
        state.map = upgraded;
        wireMapHandlers(state, upgraded);
        syncSelection(state);
        upgraded.setActiveRoute(state.activeRoute);
        upgraded.setClosedEdges(state.mode === "incident" ? closedIds(state) : []);
      }
    }
    if (state.mode === "lab") void runLab(state);
    else if (state.mode === "incident") void runIncident(state).catch(() => undefined);
    else if (state.from !== null && state.to !== null && state.from !== state.to) {
      void runPlan(state, "calc");
    }
  } catch (error) {
    setUIHTML(app, `<div class="boot error">
      <p class="boot-mark">MetroFlow</p>
      <p class="boot-note">No se pudo cargar la red: ${esc(String(error))}</p>
      <p class="boot-note">Comprueba que la API esté en ejecución (<code>./build.ps1 -Serve</code>).</p>
    </div>`);
  }
}

void init();
