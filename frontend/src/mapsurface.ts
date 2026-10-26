import type { Route } from "./api";

/**
 * Contrato común de las dos superficies de mapa (SVG editorial y MapLibre
 * cartográfico). La app solo depende de esta interfaz, así que añadir o
 * sustituir un renderizador no toca la lógica de negocio.
 */

/** Conexión mínima que el mapa necesita resaltar durante el laboratorio. */
export interface ExploredEdge {
  from: number;
  to: number;
  line: string;
}

export interface LabVisual {
  settled: Set<number>;
  frontier: Set<number>;
  activeNode: number | null;
  edge: ExploredEdge | null;
  /** dist(v) selectivo: solo las estaciones listadas muestran etiqueta. */
  dists: Map<number, number>;
}

export type MapTheme = "light" | "dark";

export interface MapSurface {
  /** Elemento raíz que se inserta/quita del contenedor del mapa. */
  el: Element;

  onStationClick(callback: (id: number) => void): void;
  onEdgeClick(callback: (edge: { from: number; to: number }) => void): void;

  setEndpoint(id: number | null, cls: "origin" | "destination"): void;
  clearActiveRoute(): void;
  setActiveRoute(route: Route | null): void;
  setClosedEdges(ids: Iterable<number>): void;
  clearClosed(): void;

  setLabVisual(v: LabVisual | null): void;
  setExploredEdge(edge: ExploredEdge | null): void;
  clearExplore(): void;

  zoomIn(): void;
  zoomOut(): void;
  resetZoom(): void;
  setTheme(theme: MapTheme): void;

  /** Libera recursos (contexto WebGL, workers). No-op en el SVG. */
  destroy(): void;
}
