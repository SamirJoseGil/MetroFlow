import type { Graph, Route } from "./api";
import { project, type Point } from "./projection";
import {
  schematicPoints,
  schematicLabelPlacements,
  SCHEMATIC_VIEW,
  type LabelPlacement,
} from "./schematic";
import type { ExploredEdge, LabVisual, MapTheme } from "./mapsurface";

export type { ExploredEdge, LabVisual, MapSurface, MapTheme } from "./mapsurface";

export type MapViewKind = "geo" | "schem";

const SVG_NS = "http://www.w3.org/2000/svg";

// Colores semánticos de las líneas del sistema. Se conservan porque comunican
// información funcional; la identidad monocromática aplica a la interfaz, no a
// la codificación de las líneas de transporte.
export const LINE_COLORS: Record<string, string> = {
  A: "#2f6fed",
  B: "#f08a1e",
  T: "#16a34a",
  K: "#ef4444",
  J: "#8b5cf6",
  H: "#ec4899",
  M: "#0ea5e9",
  O: "#14b8a6",
};

export type LineMode = "metro" | "tranvia" | "cable" | "brt";

export const LINE_INFO: Record<string, { name: string; mode: LineMode }> = {
  A: { name: "Metro A", mode: "metro" },
  B: { name: "Metro B", mode: "metro" },
  T: { name: "Tranvía", mode: "tranvia" },
  K: { name: "Metrocable K", mode: "cable" },
  J: { name: "Metrocable J", mode: "cable" },
  H: { name: "Metrocable H", mode: "cable" },
  M: { name: "Metrocable M", mode: "cable" },
  O: { name: "Metroplús O", mode: "brt" },
};

// El trazo diferencia el tipo de servicio más allá del color: sólido para
// metro, dash largo para tranvía, dash medio para cables y punteado para BRT.
export const MODE_STYLE: Record<LineMode, { width: number; dash: string }> = {
  metro: { width: 5, dash: "" },
  tranvia: { width: 4.5, dash: "14 5" },
  cable: { width: 3.6, dash: "6 4" },
  brt: { width: 4.4, dash: "1.5 5" },
};

export function lineColor(line: string): string {
  return LINE_COLORS[line] ?? "#8b5cf6";
}

export function lineMode(line: string): LineMode {
  return LINE_INFO[line]?.mode ?? "metro";
}

export function lineName(line: string): string {
  return LINE_INFO[line]?.name ?? `Línea ${line}`;
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * Etiquetas visibles: terminales y transbordos reales (estación con varias
 * líneas). Las paradas con integración peatonal Metroplús conservan el marcador
 * de integración pero su etiqueta aparece al pasar el ratón o al enfocar.
 */
function isLabeled(s: { terminal: boolean; lines: string[]; interchanges: string[] }): boolean {
  return s.terminal || (s.interchanges.length > 0 && s.lines.length > 1);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

interface ViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * En la vista geográfica solo se etiquetan intercambios y terminales. Para que
 * esas etiquetas no se tapen entre sí, la primera de un grupo cercano queda
 * arriba y la siguiente, si está a menos de un umbral, se coloca abajo.
 * Determinista: el resultado no cambia entre renders.
 */
function computeGeoLabelSides(
  graph: Graph,
  points: Map<number, Point>,
): Map<number, "above" | "below"> {
  const sides = new Map<number, "above" | "below">();
  const visible = graph.stations
    .filter((s) => isLabeled(s))
    .sort((a, b) => a.id - b.id);
  const placed: Array<{ x: number; y: number }> = [];
  for (const s of visible) {
    const p = points.get(s.id);
    if (!p) continue;
    let flip = false;
    for (const q of placed) {
      if (Math.abs(q.x - p.x) < 56 && Math.abs(q.y - p.y) < 18) {
        flip = true;
        break;
      }
    }
    sides.set(s.id, flip ? "below" : "above");
    placed.push(p);
  }
  return sides;
}

export class MapView {
  readonly svg: SVGSVGElement;
  readonly kind: MapViewKind;
  /** Compatibilidad con MapSurface: el SVG es el elemento raíz insertable. */
  get el(): Element {
    return this.svg;
  }
  /** El SVG reacciona al tema por variables CSS: no requiere acción. */
  setTheme(_theme: MapTheme): void {
    /* no-op: las variables de tema gobiernan el dibujo */
  }
  destroy(): void {
    /* el SVG se libera al quitarlo del DOM */
  }
  private points: Map<number, Point>;
  private labelPlacements: Map<number, LabelPlacement> | null;
  private labelSides: Map<number, "above" | "below"> | null = null;
  private stationsById: Map<number, { name: string }>;
  private stationEls = new Map<number, SVGGElement>();
  private routeLayer: SVGGElement;
  private exploreLayer: SVGGElement;
  private visualLayer: SVGGElement;
  private closedMarkers: SVGGElement;
  private edgesEls = new Map<number, SVGLineElement>();
  private edgeHits = new Map<number, SVGLineElement>();
  private anims: Animation[] = [];

  private readonly baseW: number;
  private readonly baseH: number;
  private vb: ViewBox;

  private drag = {
    active: false,
    moved: false,
    startX: 0,
    startY: 0,
    origX: 0,
    origY: 0,
  };

  private pinch = new Map<number, { x: number; y: number }>();
  private pinchStartDist = 0;

  /** Rastro de aristas exploradas (lab): claves ya dibujadas para no
   *  duplicar nodos SVG cuando el mismo tramo se reevalúa paso tras paso. */
  private exploreKeys = new Set<string>();

  constructor(
    private graph: Graph,
    kind: MapViewKind = "geo",
  ) {
    this.kind = kind;
    let width: number;
    let height: number;
    if (kind === "schem") {
    width = SCHEMATIC_VIEW.width;
    height = SCHEMATIC_VIEW.height;
    this.points = schematicPoints();
    this.labelPlacements = schematicLabelPlacements(graph);
    } else {
      // Ajuste de proporciones para adaptar la extensión Norte-Sur del Valle de Aburrá
      width = 680;
      height = 820; 
      const proj = project(graph.stations, width, height);
      this.points = proj.points;
      this.labelPlacements = null;
      this.labelSides = computeGeoLabelSides(graph, this.points);
    }
    this.baseW = width;
    this.baseH = height;
    this.vb = { x: 0, y: 0, w: width, h: height };

    this.stationsById = new Map(graph.stations.map((s) => [s.id, s]));

    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.setAttribute("class", `metro-map kind-${kind}`);
    // "group" y no "img": los hijos (estaciones) son botoneras enfocables y
    // "img" haría que los lectores de pantalla trataran al mapa como hoja.
    svg.setAttribute("role", "group");
    svg.setAttribute(
      "aria-label",
      kind === "geo"
        ? "Mapa geográfico de la red de transporte del Valle de Aburrá"
        : "Diagrama esquemático de la red de transporte del Valle de Aburrá",
    );
    svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
    this.svg = svg;

    const edgesLayer = this.group("edges");
    this.routeLayer = this.group("route");
    this.exploreLayer = this.group("explore");
    this.visualLayer = this.group("visual");
    const nodesLayer = this.group("nodes");
    this.closedMarkers = this.group("closed");

    this.drawEdges(edgesLayer);
    this.drawStations(nodesLayer);
    this.installInteraction();
  }

  private group(cls: string): SVGGElement {
    const g = document.createElementNS(SVG_NS, "g");
    g.setAttribute("class", cls);
    this.svg.appendChild(g);
    return g;
  }

  private coords(id: number): Point {
    const p = this.points.get(id);
    if (!p) throw new Error(`estación ${id} sin coordenada`);
    return p;
  }

  private drawEdges(layer: SVGGElement): void {
    for (const c of this.graph.connections) {
      if (!c.available) continue;
      const style = MODE_STYLE[lineMode(c.line)];
      const a = this.coords(c.from);
      const b = this.coords(c.to);
      const line = document.createElementNS(SVG_NS, "line");
      line.setAttribute("x1", a.x.toFixed(1));
      line.setAttribute("y1", a.y.toFixed(1));
      line.setAttribute("x2", b.x.toFixed(1));
      line.setAttribute("y2", b.y.toFixed(1));
      line.setAttribute("stroke", lineColor(c.line));
      line.setAttribute("stroke-width", String(style.width));
      line.setAttribute("stroke-linecap", "round");
      if (style.dash) line.setAttribute("stroke-dasharray", style.dash);
      layer.appendChild(line);
      this.edgesEls.set(c.id ?? this.edgeIndexOf(c), line);

      // Zona de contacto para seleccionar el tramo desde el mapa (simulador).
      const hit = document.createElementNS(SVG_NS, "line");
      hit.setAttribute("x1", a.x.toFixed(1));
      hit.setAttribute("y1", a.y.toFixed(1));
      hit.setAttribute("x2", b.x.toFixed(1));
      hit.setAttribute("y2", b.y.toFixed(1));
      hit.setAttribute("stroke", "transparent");
      hit.setAttribute("stroke-width", "16");
      hit.setAttribute("class", "edge-hit");
      hit.dataset.from = String(c.from);
      hit.dataset.to = String(c.to);
      hit.dataset.line = c.line;
      layer.appendChild(hit);
      this.edgeHits.set(c.id ?? -1, hit);
    }
  }

  private edgeIndexOf(c: { from: number; to: number }): number {
    const i = this.graph.connections.findIndex(
      (x) => x.from === c.from && x.to === c.to,
    );
    return i;
  }

  private drawStations(layer: SVGGElement): void {
    for (const s of this.graph.stations) {
      const p = this.coords(s.id);
      const g = document.createElementNS(SVG_NS, "g");
      const interchange = s.interchanges.length > 0;
      g.setAttribute(
        "class",
        `station${interchange ? " interchange" : ""}${s.terminal ? " terminal" : ""}`,
      );
      g.setAttribute("transform", `translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`);
      g.setAttribute("tabindex", "0");
      g.setAttribute("role", "button");
      g.setAttribute(
        "aria-label",
        `${s.name}, ${lineName(s.lines[0] ?? "A")}${interchange ? ", integración" : ""}${s.terminal ? ", terminal" : ""}`,
      );
      g.dataset.id = String(s.id);

      const base = lineColor(s.lines[0] ?? "A");
      const radius = interchange ? 5.2 : s.terminal ? 4.4 : 3.4;
      const ringWidth = interchange ? 2.4 : s.terminal ? 3 : 1.7;
      const important = isLabeled(s);

      const circle = document.createElementNS(SVG_NS, "circle");
      circle.setAttribute("class", "marker");
      circle.setAttribute("r", String(radius));
      circle.setAttribute("stroke", base);
      circle.setAttribute("stroke-width", String(ringWidth));
      g.appendChild(circle);

      // El punto interior siempre existe; el CSS decide cuándo mostrarlo
      // (integraciones, destino y estados del laboratorio).
      const dot = document.createElementNS(SVG_NS, "circle");
      dot.setAttribute("class", "dot");
      dot.setAttribute("r", "2");
      g.appendChild(dot);

      const label = document.createElementNS(SVG_NS, "text");
      const placement = this.labelPlacements?.get(s.id) ?? null;
      if (placement && placement.rotate !== 0) {
        label.setAttribute("class", `station-label rotated${important ? "" : " minor"}`);
        label.setAttribute("x", String(placement.dx));
        label.setAttribute("y", String(placement.dy));
        label.setAttribute("transform", `rotate(${placement.rotate} ${placement.dx} ${placement.dy})`);
        label.setAttribute("text-anchor", "start");
      } else if (placement) {
        label.setAttribute("class", `station-label side${important ? "" : " minor"}`);
        label.setAttribute("x", String(placement.dx));
        label.setAttribute("y", String(placement.dy));
        label.setAttribute("text-anchor", "start");
      } else {
        label.setAttribute("class", important ? "station-label" : "station-label minor");
        const below = this.labelSides?.get(s.id) === "below";
        label.setAttribute("x", "0");
        label.setAttribute("y", below ? "19" : "-11");
        label.setAttribute("text-anchor", "middle");
      }
      label.textContent = s.name;
      g.appendChild(label);

      const title = document.createElementNS(SVG_NS, "title");
      title.textContent = `${s.name} — ${s.lines.map((l) => lineName(l)).join(", ")}`;
      g.appendChild(title);

      layer.appendChild(g);
      this.stationEls.set(s.id, g);
    }
  }

  private installInteraction(): void {
    const svg = this.svg;

    svg.addEventListener("wheel", (event) => {
      event.preventDefault();
      const p = this.clientToViewBox(event.clientX, event.clientY);
      this.zoomAt(event.deltaY < 0 ? 1.12 : 1 / 1.12, p.x, p.y);
    }, { passive: false });

    svg.addEventListener("pointerdown", (event) => {
      // En pantallas táctiles el panorama/zoom del mapa queda reservado a
      // mouse y plumas: un dedo desplaza la página (gesto normal) y el zoom
      // del mapa se hace con los botones o con pellizco de dos dedos.
      this.pinch.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (this.pinch.size === 2) {
        const [a, b] = [...this.pinch.values()];
        this.pinchStartDist = Math.hypot(a.x - b.x, a.y - b.y);
        this.drag.active = false;
        svg.classList.remove("panning");
        return;
      }
      if (event.pointerType === "touch" && this.pinch.size < 2) return;
      if (event.button !== 0) return;
      this.drag.active = true;
      this.drag.moved = false;
      this.drag.startX = event.clientX;
      this.drag.startY = event.clientY;
      this.drag.origX = this.vb.x;
      this.drag.origY = this.vb.y;
      svg.classList.add("panning");
      try {
        svg.setPointerCapture(event.pointerId);
      } catch {
        /* ignorar */
      }
    });

    svg.addEventListener("pointermove", (event) => {
      if (this.pinch.has(event.pointerId)) {
        this.pinch.set(event.pointerId, { x: event.clientX, y: event.clientY });
      }
      if (this.pinch.size === 2 && this.pinchStartDist > 0) {
        const [a, b] = [...this.pinch.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        const midX = (a.x + b.x) / 2;
        const midY = (a.y + b.y) / 2;
        const factor = dist / this.pinchStartDist;
        if (Math.abs(factor - 1) > 0.02) {
          const p = this.clientToViewBox(midX, midY);
          this.zoomAt(factor, p.x, p.y);
          this.pinchStartDist = dist;
        }
        return;
      }
      if (!this.drag.active) return;
      const dx = event.clientX - this.drag.startX;
      const dy = event.clientY - this.drag.startY;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) this.drag.moved = true;
      const rect = svg.getBoundingClientRect();
      this.vb.x = this.drag.origX - (dx / rect.width) * this.vb.w;
      this.vb.y = this.drag.origY - (dy / rect.height) * this.vb.h;
      this.clampView();
      this.applyViewBox();
    });

    const endDrag = (event: PointerEvent) => {
      this.pinch.delete(event.pointerId);
      if (this.pinch.size < 2) this.pinchStartDist = 0;
      if (!this.drag.active) return;
      this.drag.active = false;
      svg.classList.remove("panning");
      try {
        svg.releasePointerCapture(event.pointerId);
      } catch {
        /* ignorar */
      }
    };
    svg.addEventListener("pointerup", endDrag);
    svg.addEventListener("pointercancel", endDrag);
  }

  private clientToViewBox(clientX: number, clientY: number): Point {
    const rect = this.svg.getBoundingClientRect();
    return {
      x: this.vb.x + ((clientX - rect.left) / rect.width) * this.vb.w,
      y: this.vb.y + ((clientY - rect.top) / rect.height) * this.vb.h,
    };
  }

  private clampView(): void {
    this.vb.w = clamp(this.vb.w, this.baseW * 0.3, this.baseW);
    this.vb.h = this.vb.w * (this.baseH / this.baseW);
    this.vb.x = clamp(this.vb.x, 0, this.baseW - this.vb.w);
    this.vb.y = clamp(this.vb.y, 0, this.baseH - this.vb.h);
  }

  private applyViewBox(): void {
    this.svg.setAttribute(
      "viewBox",
      `${this.vb.x.toFixed(2)} ${this.vb.y.toFixed(2)} ${this.vb.w.toFixed(2)} ${this.vb.h.toFixed(2)}`,
    );
  }

  private zoomAt(factor: number, cx: number, cy: number): void {
    const rw = (cx - this.vb.x) / this.vb.w;
    const rh = (cy - this.vb.y) / this.vb.h;
    const nw = clamp(this.vb.w / factor, this.baseW * 0.3, this.baseW);
    const nh = nw * (this.baseH / this.baseW);
    this.vb.x = cx - rw * nw;
    this.vb.y = cy - rh * nh;
    this.vb.w = nw;
    this.vb.h = nh;
    this.clampView();
    this.applyViewBox();
  }

  zoomIn(): void {
    this.zoomAt(1.25, this.vb.x + this.vb.w / 2, this.vb.y + this.vb.h / 2);
  }

  zoomOut(): void {
    this.zoomAt(1 / 1.25, this.vb.x + this.vb.w / 2, this.vb.y + this.vb.h / 2);
  }

  resetZoom(): void {
    this.vb = { x: 0, y: 0, w: this.baseW, h: this.baseH };
    this.applyViewBox();
  }

  onStationClick(callback: (id: number) => void): void {
    for (const [id, g] of this.stationEls) {
      const activate = () => {
        if (this.drag.moved) return;
        callback(id);
      };
      g.addEventListener("click", activate);
      g.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          callback(id);
        }
      });
    }
  }

  onEdgeClick(
    callback: (info: { from: number; to: number; line: string }) => void,
  ): void {
    for (const [, hit] of this.edgeHits) {
      hit.addEventListener("click", () => {
        if (this.drag.moved) return;
        callback({
          from: Number(hit.dataset.from),
          to: Number(hit.dataset.to),
          line: hit.dataset.line ?? "",
        });
      });
    }
  }

  setEndpoint(id: number | null, cls: "origin" | "destination"): void {
    for (const [, g] of this.stationEls) g.classList.remove(cls);
    if (id !== null) this.stationEls.get(id)?.classList.add(cls);
  }

  private cancelAnims(): void {
    for (const anim of this.anims) anim.cancel();
    this.anims = [];
  }

  clearActiveRoute(): void {
    this.cancelAnims();
    this.routeLayer.replaceChildren();
  }

  // Dibuja el recorrido activo. Si el movimiento no está reducido, revela las
  // conexiones de forma progresiva (según la longitud y el orden del tramo).
  setActiveRoute(route: Route | null): void {
    this.clearActiveRoute();
    if (!route || !route.found || route.legs.length === 0) return;

    const reduced = prefersReducedMotion();
    const legs = route.legs;
    const step = 90;

    // Capa de contraste (casco) para que la ruta resalte sobre la red base.
    for (const leg of legs) {
      const a = this.coords(leg.from);
      const b = this.coords(leg.to);
      const casing = document.createElementNS(SVG_NS, "line");
      casing.setAttribute("x1", a.x.toFixed(1));
      casing.setAttribute("y1", a.y.toFixed(1));
      casing.setAttribute("x2", b.x.toFixed(1));
      casing.setAttribute("y2", b.y.toFixed(1));
      casing.setAttribute("class", "route-casing");
      this.routeLayer.appendChild(casing);
    }

    legs.forEach((leg, index) => {
      const a = this.coords(leg.from);
      const b = this.coords(leg.to);
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      const color = lineColor(leg.line);

      const line = document.createElementNS(SVG_NS, "line");
      line.setAttribute("x1", a.x.toFixed(1));
      line.setAttribute("y1", a.y.toFixed(1));
      line.setAttribute("x2", b.x.toFixed(1));
      line.setAttribute("y2", b.y.toFixed(1));
      line.setAttribute("stroke", color);
      line.setAttribute("stroke-width", "7");
      line.setAttribute("stroke-linecap", "round");
      line.setAttribute("class", "route-leg");
      this.routeLayer.appendChild(line);

      if (reduced) return;

      line.setAttribute("stroke-dasharray", `${length} ${length}`);
      line.setAttribute("stroke-dashoffset", String(length));
      this.anims.push(
        line.animate(
          [{ strokeDashoffset: length }, { strokeDashoffset: 0 }],
          { duration: 320, delay: index * step, easing: "ease-out", fill: "both" },
        ),
      );
    });

    // Marcadores de estación de la ruta, aparecen en cascada.
    const seen = new Set<number>();
    const ordered = [route.stations[0]?.id, ...legs.map((l) => l.to)].filter(
      (id): id is number => id !== undefined,
    );
    ordered.forEach((id, index) => {
      if (seen.has(id)) return;
      seen.add(id);
      const p = this.coords(id);
      const dot = document.createElementNS(SVG_NS, "circle");
      dot.setAttribute("cx", p.x.toFixed(1));
      dot.setAttribute("cy", p.y.toFixed(1));
      dot.setAttribute("r", "2.6");
      dot.setAttribute("class", "route-dot");
      this.routeLayer.appendChild(dot);

      if (reduced) return;
      this.anims.push(
        dot.animate(
          [{ opacity: 0 }, { opacity: 1 }],
          { duration: 220, delay: index * step, easing: "ease-out", fill: "both" },
        ),
      );
    });
  }

  /** Estados del laboratorio: asentados, frontera, estado activo y d(v). */
  setLabVisual(v: LabVisual | null): void {
    for (const [id, g] of this.stationEls) {
      const settled = v?.settled.has(id) ?? false;
      const frontier = v?.frontier.has(id) ?? false;
      const active = v?.activeNode === id;
      g.classList.toggle("settled", settled);
      g.classList.toggle("frontier", frontier);
      g.classList.toggle("active", active);
      g.classList.toggle(
        "explored",
        settled || frontier || active,
      );
    }
    this.visualLayer.replaceChildren();
    if (v) {
      // Arista evaluada (el rastro acumulado no duplica tramos ya dibujados).
      if (v.edge) this.drawExploreEdge(v.edge);
      // Etiquetas de distancia selectivas (solo el subconjunto indicado),
      // con resolución de colisiones determinista entre etiquetas.
      const used: Array<{ cx: number; cy: number }> = [];
      for (const [id, dist] of v.dists) {
        const g = this.stationEls.get(id);
        if (!g) continue;
        const anchor = this.coords(id);
        const label = this.placeDistLabel(anchor, used);
        used.push({ cx: label.cx, cy: label.cy });
        label.el.setAttribute("class", "dist-label");
        label.el.textContent = `d=${dist.toFixed(1)}`;
        this.visualLayer.appendChild(label.el);
      }
    }
  }

  /**
   * Coloca una etiqueta d= buscando entre offsets candidatos el primero que
   * no colisiona con las ya colocadas en este frame (determinista: siempre
   * evalúa los candidatos en el mismo orden, sin aleatoriedad ni layout-run).
   */
  private placeDistLabel(
    anchor: Point,
    used: Array<{ cx: number; cy: number }>,
  ): { el: SVGTextElement; cx: number; cy: number } {
    const candidates =
      this.kind === "schem"
        ? [
            { dx: 8, dy: -8, anchor: "start" },
            { dx: 10, dy: -24, anchor: "start" },
            { dx: -10, dy: -2, anchor: "end" },
            { dx: 10, dy: 12, anchor: "start" },
          ]
        : [
            { dx: 0, dy: -30, anchor: "middle" },
            { dx: 0, dy: -48, anchor: "middle" },
            { dx: -14, dy: -18, anchor: "end" },
            { dx: 14, dy: -18, anchor: "start" },
            { dx: -14, dy: 6, anchor: "end" },
          ];
    const HALF_W = 26; // semiancho aproximado de "d=999.9" en la fuente mono
    const HALF_H = 7;
    let chosen = candidates[candidates.length - 1];
    for (const candidate of candidates) {
      const cx = anchor.x + candidate.dx + (candidate.anchor === "end" ? -HALF_W : candidate.anchor === "start" ? HALF_W : 0);
      const cy = anchor.y + candidate.dy;
      if (
        !used.some(
          (u) => Math.abs(u.cx - cx) < 2 * HALF_W && Math.abs(u.cy - cy) < 2 * HALF_H,
        )
      ) {
        chosen = candidate;
        break;
      }
    }
    const el = document.createElementNS(SVG_NS, "text");
    el.setAttribute("x", "0");
    el.setAttribute("y", "0");
    el.setAttribute("text-anchor", chosen.anchor);
    el.setAttribute("transform", `translate(${anchor.x + chosen.dx} ${anchor.y + chosen.dy})`);
    const cx = anchor.x + chosen.dx + (chosen.anchor === "end" ? -HALF_W : chosen.anchor === "start" ? HALF_W : 0);
    return { el, cx, cy: anchor.y + chosen.dy };
  }

  private drawExploreEdge(edge: ExploredEdge): void {
    // El rastro acumulado del laboratorio no debe repetir un tramo que ya
    // dibujó (la misma arista puede evaluarse en varios frames seguidos y
    // en avanzar/retroceder): si ya está en el rastro, no añadimos otro nodo.
    const key = `${Math.min(edge.from, edge.to)}:${Math.max(edge.from, edge.to)}`;
    if (this.exploreKeys.has(key)) return;
    this.exploreKeys.add(key);
    const a = this.coords(edge.from);
    const b = this.coords(edge.to);
    const line = document.createElementNS(SVG_NS, "line");
    line.setAttribute("x1", a.x.toFixed(1));
    line.setAttribute("y1", a.y.toFixed(1));
    line.setAttribute("x2", b.x.toFixed(1));
    line.setAttribute("y2", b.y.toFixed(1));
    line.setAttribute("stroke", lineColor(edge.line));
    line.setAttribute("class", "explore-edge");
    this.exploreLayer.appendChild(line);
  }

  setExploredNode(id: number | null): void {
    for (const [, g] of this.stationEls) g.classList.remove("explored");
    if (id !== null) this.stationEls.get(id)?.classList.add("explored");
  }

  setExploredEdge(edge: ExploredEdge | null): void {
    this.exploreLayer.replaceChildren();
    this.exploreKeys.clear();
    if (!edge) return;
    this.drawExploreEdge(edge);
  }

  clearExplore(): void {
    this.exploreKeys.clear();
    this.exploreLayer.replaceChildren();
    for (const [, g] of this.stationEls) {
      g.classList.remove("explored", "settled", "frontier", "active");
    }
    this.visualLayer.replaceChildren();
  }

  /**
   * Marca los tramos cerrados por el usuario del simulador. `ids` contiene los
   * índices dirigidos de connection.json cerrados; se disponible=false solo en
   * la copia por solicitud (el backend), aquí se dibuja la indicación.
   */
  setClosedEdges(ids: Iterable<number>): void {
    this.closedMarkers.replaceChildren();
    for (const id of ids) {
      const edge = this.edgesEls.get(id);
      const c = id >= 0 && id < this.graph.connections.length
        ? this.graph.connections[id]
        : undefined;
      if (!edge || !c) continue;
      const a = this.coords(c.from);
      const b = this.coords(c.to);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const dy = b.y - a.y;
      const dx = b.x - a.x;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;
      const size = 8;
      const mark = document.createElementNS(SVG_NS, "g");
      mark.setAttribute("class", "closed-mark");
      mark.setAttribute(
        "transform",
        `translate(${mid.x} ${mid.y}) rotate(${Math.atan2(dy, dx) * (180 / Math.PI)})`,
      );
      for (const sign of [-1, 1]) {
        const seg = document.createElementNS(SVG_NS, "line");
        seg.setAttribute("x1", String((0.85 * dx) / len - sign * nx * size));
        seg.setAttribute("y1", String((0.85 * dy) / len - sign * ny * size));
        seg.setAttribute("x2", String((1.15 * dx) / len + sign * nx * size));
        seg.setAttribute("y2", String((1.15 * dy) / len + sign * ny * size));
        mark.appendChild(seg);
      }
      this.closedMarkers.appendChild(mark);
    }
  }

  clearClosed(): void {
    this.closedMarkers.replaceChildren();
  }

  stationName(id: number): string {
    return this.stationsById.get(id)?.name ?? String(id);
  }

  station(id: number): { name: string } | undefined {
    return this.stationsById.get(id);
  }
}
