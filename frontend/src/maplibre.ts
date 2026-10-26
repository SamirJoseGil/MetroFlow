import { Map as MapLibreMap, LngLatBounds, setWorkerUrl } from "maplibre-gl";
import type {
  GeoJSONSource,
  LayerSpecification,
  MapLayerMouseEvent,
  StyleSpecification,
} from "maplibre-gl";
import type * as GeoJSON from "geojson";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import "maplibre-gl/dist/maplibre-gl.css";

import type { Connection, Graph, Route, Station } from "./api";
import { LINE_INFO, MODE_STYLE, lineColor } from "./map";
import type { ExploredEdge, LabVisual, MapSurface, MapTheme } from "./mapsurface";

/**
 * Vista geográfica cartográfica (MapLibre GL JS + teselas CARTO/OSM).
 *
 * Decisión de viabilidad (documentada en docs/INFORME_FINAL_2.0.md):
 *  - Licencia: MapLibre GL JS es BSD-3-Clause; las teselas CARTO/OSM exigen
 *    atribución (se muestra en el control de atribución del mapa).
 *  - Coordenadas: stations.json trae lat/lng reales → posición geográfica fiel.
 *  - Rendimiento/tamaño: dependencia grande (~29 MB desempaquetada, ~250 KB gzip
 *    en el bundle) pero se carga sólo cuando se elige la vista geográfica.
 *  - Teselas/sin conexión: requieren red. Si fallan, la app vuelve al SVG
 *    geográfico determinista (fallback offline) en vez de dejar el mapa vacío.
 *  - Animaciones: cámara y fuentes GeoJSON permiten dibujo progresivo del
 *    recorrido, marcador de avance y resaltado por evento del laboratorio.
 */

// Teselas OpenStreetMap (sin clave). Se desaturan por completo con las
// propiedades raster-* de MapLibre para integrarse en la identidad monocroma;
// no se inventa ni se transforma la geografía, sólo su presentación cromática.
const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors';

/** Presentación del raster base según el tema (misma fuente, distinta luz). */
function rasterPaint(theme: MapTheme): Record<string, number> {
  // Mayor saturación y contraste en light para que las etiquetas resalten;
  // en dark, más contraste y algo de brillo para legibilidad sobre fondo oscuro.
  return theme === "dark"
    ? {
        "raster-saturation": -0.8,
        "raster-contrast": 1.05,
        "raster-brightness-min": 0.05,
        "raster-brightness-max": 0.7,
        "raster-opacity": 0.92,
      }
    : {
        "raster-saturation": -0.7,
        "raster-contrast": 0.88,
        "raster-brightness-min": 0.55,
        "raster-brightness-max": 1.05,
        "raster-opacity": 0.88,
      };
}

interface Palette {
  surface: string;
  surface2: string;
  ink: string;
  ink2: string;
  line: string;
  casing: string;
  danger: string;
}

const PALETTES: Record<MapTheme, Palette> = {
  light: {
    surface: "#ffffff", surface2: "#f4f4f5", ink: "#0a0a0a", ink2: "#52525b",
    line: "#d4d4d8", casing: "#ffffff", danger: "#b91c1c",
  },
  dark: {
    surface: "#0d0d0e", surface2: "#151517", ink: "#fafafa", ink2: "#a1a1aa",
    line: "#2f2f33", casing: "#0a0a0a", danger: "#f87171",
  },
};

type StationState =
  | "normal" | "settled" | "frontier" | "active" | "origin" | "destination";

/** Estaciones que llevan etiqueta permanente (terminales y transbordos reales). */
function isLabeled(s: Station): boolean {
  return s.terminal || (s.interchanges.length > 0 && s.lines.length > 1);
}

function num(n: unknown): number {
  return typeof n === "number" ? n : 0;
}

function coord(graph: Graph, id: number): [number, number] {
  const s = graph.stations.find((x) => x.id === id);
  return [s?.lng ?? 0, s?.lat ?? 0];
}

export class MapLibreView implements MapSurface {
  readonly el: HTMLDivElement;
  private map!: MapLibreMap;
  private graph: Graph;
  private theme: MapTheme;
  private pal: Palette;
  private stations: Station[];
  private stationState = new Map<number, StationState>();
  private distLabels = new Map<number, number>();
  private explore: ExploredEdge | null = null;
  private closed = new Set<number>();
  private route: Route | null = null;
  private animFrame = 0;
  private destroyed = false;

  private constructor(graph: Graph, theme: MapTheme) {
    this.graph = graph;
    this.theme = theme;
    this.pal = PALETTES[theme];
    this.stations = graph.stations;
    this.el = document.createElement("div");
    this.el.className = "maplibre-host";
  }

  /** Crea el mapa; rechaza si el estilo/teselas no cargan (fallback a SVG). */
  static create(graph: Graph, theme: MapTheme): Promise<MapLibreView> {
    const view = new MapLibreView(graph, theme);
    return view.init();
  }

  private init(): Promise<MapLibreView> {
    // Vite no resuelve `new URL('./maplibre-gl-worker.mjs', import.meta.url)`
    // dentro del bundle: se indica explícitamente la URL del worker.
    setWorkerUrl(workerUrl);
    const [west, south, east, north] = this.bounds();
    return new Promise((resolve, reject) => {
      let settled = false;
      const fail = (reason: string) => {
        if (settled) return;
        settled = true;
        reject(new Error(reason));
      };
      const timer = window.setTimeout(() => fail("tiempo de carga agotado"), 12000);

      const map = new MapLibreMap({
        container: this.el,
        style: this.buildStyle(),
        bounds: [west, south, east, north],
        fitBoundsOptions: { padding: 48, duration: 0 },
        attributionControl: { compact: true, customAttribution: ATTRIBUTION },
        maxBounds: [
          [west - 1.5, south - 1.5],
          [east + 1.5, north + 1.5],
        ],
      });
      this.map = map;

      map.on("error", (e: unknown) => {
        const msg = String((e as { error?: Error })?.error?.message ?? "");
        // Los errores de tesela aislados no invalidan el mapa; sólo un fallo
        // de estilo/WebGL merece el fallback.
        if (/style|webgl|context/i.test(msg)) fail(`mapa: ${msg}`);
      });
      map.on("load", () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        this.addLayers();
        this.bindEvents();
        resolve(this);
      });
    });
  }

  private bounds(): [number, number, number, number] {
    const lngs = this.stations.map((s) => s.lng);
    const lats = this.stations.map((s) => s.lat);
    const west = Math.min(...lngs) - 0.06;
    const east = Math.max(...lngs) + 0.06;
    const south = Math.min(...lats) - 0.05;
    const north = Math.max(...lats) + 0.05;
    return [west, south, east, north];
  }

  private buildStyle(): StyleSpecification {
    return {
      version: 8,
      glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
      sources: {
        carto: {
          type: "raster",
          tiles: [TILE_URL],
          tileSize: 256,
          attribution: ATTRIBUTION,
        },
        stations: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
        connections: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
        route: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
        "route-casing": { type: "geojson", data: { type: "FeatureCollection", features: [] } },
        explore: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
        closed: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
        dist: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
        traveler: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
      },
      layers: [
        { id: "carto", type: "raster", source: "carto", paint: rasterPaint(this.theme) },
      ],
    };
  }

  private addLayers(): void {
    const map = this.map;
    const pal = this.pal;

    const add = (layer: LayerSpecification) => {
      if (!map.getLayer(layer.id)) map.addLayer(layer);
    };

    // Recorrido: funda (casing) + tramos coloreados por línea.
    add({
      id: "route-casing", type: "line", source: "route-casing",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": pal.casing, "line-width": 10, "line-opacity": 0.95 },
    });
    add({
      id: "route-legs", type: "line", source: "route",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": ["get", "color"],
        "line-width": 6,
      },
    });

    // Red base: conexiones por línea (color y trazo semánticos).
    add({
      id: "connections", type: "line", source: "connections",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": ["get", "color"],
        "line-width": ["get", "width"],
        "line-dasharray": ["get", "dash"],
        "line-opacity": 0.95,
      },
    });

    // Zona de contacto para cerrar tramos (invisible, por encima de la red).
    add({
      id: "connections-hit", type: "line", source: "connections",
      paint: { "line-color": "rgba(0,0,0,0)", "line-width": 18 },
    });

    // Rastro del laboratorio.
    add({
      id: "explore", type: "line", source: "explore",
      layout: { "line-cap": "round" },
      paint: {
        "line-color": ["get", "color"],
        "line-width": 5,
        "line-dasharray": [0.6, 2.4],
        "line-opacity": 0.95,
      },
    });

    // Tramos cerrados: marca roja + aspa en el punto medio.
    add({
      id: "closed-line", type: "line", source: "closed",
      layout: { "line-cap": "round" },
      paint: { "line-color": pal.danger, "line-width": 3.4, "line-dasharray": [4, 3] },
    });
    add({
      id: "closed-mark", type: "symbol", source: "closed",
      layout: {
        "symbol-placement": "point",
        "text-field": "✕",
        "text-size": 13,
        "text-font": ["Open Sans Regular"],
      },
      paint: { "text-color": pal.danger },
    });

    // Estaciones.
    add({
      id: "stations", type: "circle", source: "stations",
      paint: {
        "circle-radius": [
          "case", ["==", ["get", "state"], "active"], 8,
          ["get", "terminal"], 6.5, ["get", "interchange"], 5.5, 4.5,
        ],
        "circle-color": [
          "case",
          ["==", ["get", "state"], "origin"], pal.ink,
          ["==", ["get", "state"], "destination"], pal.surface,
          ["==", ["get", "state"], "settled"], pal.ink,
          pal.surface,
        ],
        "circle-stroke-color": [
          "case",
          ["==", ["get", "state"], "destination"], pal.ink,
          ["==", ["get", "state"], "frontier"], pal.ink,
          pal.line,
        ],
        "circle-stroke-width": [
          "case",
          ["==", ["get", "state"], "active"], 4,
          ["==", ["get", "state"], "frontier"], 3,
          ["==", ["get", "state"], "destination"], 2.5,
          2,
        ],
      },
    });

    // Etiquetas permanentes: jerarquía por zoom (terminales siempre; los
    // transbordos reales a partir de un zoom de detalle) con padding amplio.
    add({
      id: "labels", type: "symbol", source: "stations",
      filter: [
        "case",
        ["<", ["zoom"], 12],
        ["==", ["get", "terminal"], true],
        ["get", "labeled"],
      ],
      layout: {
        "text-field": ["get", "name"],
        "text-size": 11,
        "text-offset": [0, -1.5],
        "text-anchor": "top",
        "text-optional": true,
        "text-allow-overlap": false,
        "text-padding": 2,
        "text-line-height": 1.1,
      },
      paint: { "text-color": pal.ink2, "text-halo-color": pal.casing, "text-halo-width": 2 },
    });

    // Etiquetas de estaciones secundarias, sólo al pasar el cursor.
    add({
      id: "labels-hover", type: "symbol", source: "stations",
      filter: [
        "all",
        ["!", ["get", "labeled"]],
        ["boolean", ["feature-state", "hover"], false],
      ],
      layout: {
        "text-field": ["get", "name"],
        "text-size": 11,
        "text-offset": [0, -1.5],
        "text-anchor": "top",
        "text-padding": 2,
      },
      paint: { "text-color": pal.ink2, "text-halo-color": pal.casing, "text-halo-width": 2 },
    });

    // dist(v) selectivo del laboratorio.
    add({
      id: "dist-labels", type: "symbol", source: "dist",
      layout: {
        "text-field": ["get", "text"],
        "text-size": 10,
        "text-offset": [0, -2.6],
        "text-anchor": "top",
      },
      paint: { "text-color": pal.ink, "text-halo-color": pal.casing, "text-halo-width": 3 },
    });

    // Marcador de avance animado sobre la ruta.
    add({
      id: "traveler", type: "circle", source: "traveler",
      paint: {
        "circle-radius": 7,
        "circle-color": pal.ink,
        "circle-stroke-color": pal.casing,
        "circle-stroke-width": 3,
      },
    });

    this.refreshStations();
    this.refreshConnections();
  }

  private bindEvents(): void {
    const map = this.map;
    map.on("click", "stations", (e: MapLayerMouseEvent) => {
      const f = e.features?.[0];
      if (!f) return;
      const id = Number((f.properties as { id: number }).id);
      if (Number.isFinite(id)) this.stationClick?.(id);
    });
    map.on("click", "connections-hit", (e: MapLayerMouseEvent) => {
      const f = e.features?.[0];
      if (!f) return;
      const p = f.properties as { from: number; to: number };
      this.edgeClick?.({ from: Number(p.from), to: Number(p.to) });
    });
    // Etiquetas de estaciones secundarias al pasar el cursor.
    let hoverId: number | null = null;
    map.on("mousemove", "stations", (e: MapLayerMouseEvent) => {
      const f = e.features?.[0];
      const id = f ? Number((f.properties as { id: number }).id) : null;
      if (hoverId !== id) {
        if (hoverId !== null) {
          map.removeFeatureState({ source: "stations", id: hoverId });
        }
        if (id !== null) {
          map.setFeatureState({ source: "stations", id }, { hover: true });
        }
        hoverId = id;
      }
    });
    map.on("mouseleave", "stations", () => {
      if (hoverId !== null) {
        map.removeFeatureState({ source: "stations", id: hoverId });
        hoverId = null;
      }
    });
  }

  private stationClick: ((id: number) => void) | null = null;
  private edgeClick: ((edge: { from: number; to: number }) => void) | null = null;

  onStationClick(callback: (id: number) => void): void {
    this.stationClick = callback;
  }
  onEdgeClick(callback: (edge: { from: number; to: number }) => void): void {
    this.edgeClick = callback;
  }

  // ---------------------------------------------------------------- datos

  private refreshStations(): void {
    const features: GeoJSON.Feature<GeoJSON.Point>[] = this.stations.map((s) => ({
      type: "Feature",
      id: s.id,
      geometry: { type: "Point", coordinates: [s.lng, s.lat] },
      properties: {
        id: s.id,
        name: s.name,
        terminal: s.terminal,
        interchange: s.interchanges.length > 0,
        labeled: isLabeled(s),
        state: this.stationState.get(s.id) ?? "normal",
      },
    }));
    const src = this.map.getSource("stations") as GeoJSONSource;
    src.setData({ type: "FeatureCollection", features });
  }

  private refreshConnections(): void {
    const features = this.graph.connections
      .filter((c) => c.available)
      .map((c) => this.connectionFeature(c));
    const src = this.map.getSource("connections") as GeoJSONSource;
    src.setData({ type: "FeatureCollection", features });
  }

  private connectionFeature(c: Connection): GeoJSON.Feature<GeoJSON.LineString> {
    const mode = MODE_STYLE[LINE_INFO[c.line]?.mode ?? "metro"];
    return {
      type: "Feature",
      id: c.id ?? this.graph.connections.indexOf(c),
      geometry: { type: "LineString", coordinates: [coord(this.graph, c.from), coord(this.graph, c.to)] },
      properties: {
        id: c.id,
        from: c.from,
        to: c.to,
        line: c.line,
        color: lineColor(c.line),
        width: mode.width,
        dash: mode.dash ? [3, 4] : [1, 0],
      },
    };
  }

  // ------------------------------------------------------------- endpoints

  setEndpoint(id: number | null, cls: "origin" | "destination"): void {
    const prev = this.stationState.get(id ?? -1);
    if (id !== null) this.stationState.set(id, cls);
    // Limpia el endpoint previo de ese rol.
    for (const [sid, st] of this.stationState) {
      if (st === cls && sid !== id) this.stationState.delete(sid);
    }
    void prev;
    this.refreshStations();
  }

  // ----------------------------------------------------------------- ruta

  setActiveRoute(route: Route | null): void {
    this.route = route;
    this.stopAnimation();
    if (!route || !route.found) {
      this.setData("route", []);
      this.setData("route-casing", []);
      this.setData("traveler", []);
      return;
    }
    this.drawRoute(1);
    this.fitRoute();
    if (!this.reducedMotion()) this.animateRoute();
  }

  clearActiveRoute(): void {
    this.route = null;
    this.stopAnimation();
    this.setData("route", []);
    this.setData("route-casing", []);
    this.setData("traveler", []);
  }

  /** Geometrías del recorrido en el estado de progreso `p` (0..1). */
  private routeParts(p: number): {
    legs: GeoJSON.Feature<GeoJSON.LineString>[];
    casing: GeoJSON.Feature<GeoJSON.LineString> | null;
    traveler: [number, number] | null;
  } {
    const route = this.route;
    if (!route || !route.found) return { legs: [], casing: null, traveler: null };
    const legs = route.legs ?? [];
    const n = legs.length;
    if (n === 0) return { legs: [], casing: null, traveler: null };
    const exact = Math.min(Math.max(p, 0), 1) * n;
    const full = Math.floor(exact);
    const frac = exact - full;
    const out: GeoJSON.Feature<GeoJSON.LineString>[] = [];
    let traveler: [number, number] | null = null;
    for (let i = 0; i < n; i++) {
      const leg = legs[i];
      const a = coord(this.graph, leg.from);
      const b = coord(this.graph, leg.to);
      if (i < full) {
        out.push(this.legFeature(leg, a, b));
        traveler = b;
      } else if (i === full) {
        const t = Math.max(frac, 0.0001);
        const mid: [number, number] = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        out.push(this.legFeature(leg, a, mid));
        traveler = mid;
      }
    }
    const casing: GeoJSON.Feature<GeoJSON.LineString> | null = out.length
      ? {
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: out.flatMap((f) => f.geometry.coordinates),
          },
          properties: {},
        }
      : null;
    return { legs: out, casing, traveler };
  }

  private legFeature(
    leg: Route["legs"][number],
    a: [number, number],
    b: [number, number],
  ): GeoJSON.Feature<GeoJSON.LineString> {
    return {
      type: "Feature",
      geometry: { type: "LineString", coordinates: [a, b] },
      properties: { line: leg.line, color: lineColor(leg.line) },
    };
  }

  private drawRoute(p: number): void {
    const { legs, casing, traveler } = this.routeParts(p);
    this.setData("route", legs);
    this.setData("route-casing", casing ? [casing] : []);
    this.setData("traveler", traveler ? [this.pointFeature(traveler)] : []);
  }

  private pointFeature(xy: [number, number]): GeoJSON.Feature<GeoJSON.Point> {
    return { type: "Feature", geometry: { type: "Point", coordinates: xy }, properties: {} };
  }

  private stopAnimation(): void {
    if (this.animFrame) {
      cancelAnimationFrame(this.animFrame);
      this.animFrame = 0;
    }
  }

  private reducedMotion(): boolean {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  /** Dibujo progresivo del recorrido + marcador de avance (eventos reales). */
  private animateRoute(): void {
    const duration = 1100;
    const start = performance.now();
    const step = (now: number) => {
      if (this.destroyed) return;
      const p = Math.min((now - start) / duration, 1);
      this.drawRoute(p);
      if (p < 1) this.animFrame = requestAnimationFrame(step);
    };
    this.animFrame = requestAnimationFrame(step);
  }

  private fitRoute(): void {
    const route = this.route;
    if (!route || !route.found || !route.legs?.length) return;
    const coords = route.legs.flatMap((l) => [coord(this.graph, l.from), coord(this.graph, l.to)]);
    const bounds = coords.reduce(
      (acc, c) => acc.extend(c as [number, number]),
      new LngLatBounds(coords[0], coords[0]),
    );
    this.map.fitBounds(bounds, { padding: 70, duration: this.reducedMotion() ? 0 : 700 });
  }

  // ----------------------------------------------------------- laboratorio

  setLabVisual(v: LabVisual | null): void {
    if (!v) {
      this.stationState.clear();
      this.distLabels.clear();
      this.explore = null;
    } else {
      this.stationState.clear();
      for (const id of v.settled) this.stationState.set(id, "settled");
      for (const id of v.frontier) if (!this.stationState.has(id)) this.stationState.set(id, "frontier");
      if (v.activeNode !== null) this.stationState.set(v.activeNode, "active");
      this.distLabels = new Map(v.dists);
      this.explore = v.edge;
    }
    this.refreshStations();
    this.refreshExplore();
    this.refreshDist();
  }

  setExploredEdge(edge: ExploredEdge | null): void {
    this.explore = edge;
    this.refreshExplore();
  }

  private refreshExplore(): void {
    if (!this.explore) {
      this.setData("explore", []);
      return;
    }
    const { from, to, line } = this.explore;
    this.setData("explore", [
      {
        type: "Feature",
        geometry: { type: "LineString", coordinates: [coord(this.graph, from), coord(this.graph, to)] },
        properties: { color: lineColor(line) },
      },
    ]);
  }

  clearExplore(): void {
    this.explore = null;
    this.setData("explore", []);
  }

  private refreshDist(): void {
    const features: GeoJSON.Feature<GeoJSON.Point>[] = [];
    for (const [id, dist] of this.distLabels) {
      const s = this.stations.find((x) => x.id === id);
      if (!s) continue;
      features.push({
        type: "Feature",
        id,
        geometry: { type: "Point", coordinates: [s.lng, s.lat] },
        properties: { text: `d=${dist.toFixed(1)}` },
      });
    }
    this.setData("dist", features);
  }

  // -------------------------------------------------------------- cierres

  setClosedEdges(ids: Iterable<number>): void {
    this.closed = new Set(ids);
    const features: GeoJSON.Feature[] = [];
    for (const id of this.closed) {
      const c = this.graph.connections[id];
      if (!c) continue;
      features.push({
        type: "Feature",
        geometry: { type: "LineString", coordinates: [coord(this.graph, c.from), coord(this.graph, c.to)] },
        properties: {},
      });
    }
    this.setData("closed", features);
  }

  clearClosed(): void {
    this.closed.clear();
    this.setData("closed", []);
  }

  // ------------------------------------------------------------ controles

  zoomIn(): void {
    this.map.zoomIn({ duration: this.reducedMotion() ? 0 : 220 });
  }
  zoomOut(): void {
    this.map.zoomOut({ duration: this.reducedMotion() ? 0 : 220 });
  }
  resetZoom(): void {
    const [w, s, e, n] = this.bounds();
    this.map.fitBounds([w, s, e, n], { padding: 48, duration: this.reducedMotion() ? 0 : 400 });
  }

  setTheme(theme: MapTheme): void {
    this.theme = theme;
    this.pal = PALETTES[theme];
    // Misma fuente de teselas: cambia la presentación lumínica del raster.
    for (const [k, v] of Object.entries(rasterPaint(theme))) {
      this.map.setPaintProperty("carto", k as never, v as never);
    }
    this.applyPalette();
  }

  /** Reaplica la paleta del tema a las capas de datos (la raster cambia sola). */
  private applyPalette(): void {
    const pal = this.pal;
    const set = (id: string, props: Record<string, unknown>) => {
      for (const [k, v] of Object.entries(props)) {
        this.map.setPaintProperty(
          id,
          k as Parameters<MapLibreMap["setPaintProperty"]>[1],
          v as never,
        );
      }
    };
    set("route-casing", { "line-color": pal.casing });
    set("stations", {
      "circle-color": [
        "case",
        ["==", ["get", "state"], "origin"], pal.ink,
        ["==", ["get", "state"], "destination"], pal.surface,
        ["==", ["get", "state"], "settled"], pal.ink,
        pal.surface,
      ],
      "circle-stroke-color": [
        "case",
        ["==", ["get", "state"], "destination"], pal.ink,
        ["==", ["get", "state"], "frontier"], pal.ink,
        pal.line,
      ],
    });
    set("labels", { "text-color": pal.ink2, "text-halo-color": pal.casing });
    set("labels-hover", { "text-color": pal.ink2, "text-halo-color": pal.casing });
    set("dist-labels", { "text-color": pal.ink, "text-halo-color": pal.casing });
    set("closed-line", { "line-color": pal.danger });
    set("closed-mark", { "text-color": pal.danger });
    set("traveler", { "circle-color": pal.ink, "circle-stroke-color": pal.casing });
  }

  destroy(): void {
    this.destroyed = true;
    this.stopAnimation();
    try {
      this.map?.remove();
    } catch {
      /* el mapa pudo no haber cargado */
    }
  }

  private setData(source: string, features: GeoJSON.Feature[]): void {
    const src = this.map?.getSource(source) as GeoJSONSource | undefined;
    src?.setData({ type: "FeatureCollection", features });
  }
}

/** Factoría de superficies: vista geográfica cartográfica o esquemática SVG. */
export async function createMapSurface(
  graph: Graph,
  kind: "geo" | "schem",
  theme: MapTheme,
  svgFallback: MapSurface,
): Promise<MapSurface> {
  if (kind === "geo") {
    try {
      return await MapLibreView.create(graph, theme);
    } catch {
      return svgFallback; // sin conexión / WebGL: se mantiene el SVG geográfico
    }
  }
  return svgFallback;
}

/** Utilidad compartida con el SVG para mantener la misma jerarquía de etiquetas. */
export { isLabeled, num };
