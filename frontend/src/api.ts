export interface Station {
  id: number;
  name: string;
  lines: string[];
  lat: number;
  lng: number;
  municipio: string;
  position: string;
  terminal: boolean;
  interchanges: string[];
}

export interface Connection {
  /** Índice dirigido de la arista en el grafo (0..114). Sirve para cerrarla
   *  por solicitud (closedConnections). Es la posición en /api/graph. */
  id?: number;
  from: number;
  to: number;
  fromName: string;
  toName: string;
  line: string;
  timeMin: number;
  distanceKm: number;
  type: string;
  available: boolean;
}

export interface Graph {
  transferPenaltyMin: number;
  lines: string[];
  stationCount: number;
  edgeCount: number;
  stations: Station[];
  connections: Connection[];
}

export interface Leg {
  from: number;
  to: number;
  fromName: string;
  toName: string;
  line: string;
  timeMin: number;
  distanceKm: number;
  type: string;
}

export interface Route {
  found: boolean;
  criterion: string;
  totalMin: number;
  totalKm: number;
  stops: number;
  transfers: number;
  stations: { id: number; name: string }[];
  legs: Leg[];
}

export interface AlgorithmStats {
  pushes: number;
  extractions: number;
  relaxations: number;
  updates: number;
  staleEntries: number;
  settledNodes: number;
  elapsedMs: number;
}

export interface TraceEvent {
  type: string;
  node: number;
  from: number;
  dist: number;
  previous: number;
  line: string;
  note: string;
  nodeName?: string;
  fromName?: string;
  fromLine?: string;
  previousFrom?: number;
  previousFromLine?: string;
}

export interface Trace {
  stats: AlgorithmStats;
  events: TraceEvent[];
}

export type Criterion = "time" | "hops";

async function fetchJSON<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

function post<T>(url: string, body: unknown): Promise<T> {
  return fetchJSON<T>(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export interface ExportParams {
  from: number;
  to: number;
  criterion?: Criterion;
  k?: number;
  index?: number;
  closedConnections?: number[];
}

export interface RouteRequest {
  from: number;
  to: number;
  criterion?: Criterion;
  k?: number;
  closedConnections?: number[];
}

function toBody(r: RouteRequest): Record<string, unknown> {
  const body: Record<string, unknown> = { from: r.from, to: r.to };
  if (r.criterion) body.criterion = r.criterion;
  if (r.k && r.k > 1) body.k = r.k;
  if (r.closedConnections && r.closedConnections.length > 0) {
    body.closedConnections = r.closedConnections;
  }
  return body;
}

export const api = {
  health: () => fetchJSON<{ status: string }>("/api/health"),
  graph: () => fetchJSON<Graph>("/api/graph"),
  route: (r: RouteRequest) => post<Route>("/api/route", toBody(r)),
  alternatives: (from: number, to: number, closedConnections?: number[]) =>
    post<Route[]>("/api/route", {
      from,
      to,
      k: 3,
      ...(closedConnections && closedConnections.length > 0
        ? { closedConnections }
        : {}),
    }),
  trace: (r: RouteRequest) => post<Trace>("/api/trace", toBody(r)),

  // Descarga el documento (grafo + ruta seleccionada + escenario) como texto.
  exportRoute: async (params: ExportParams): Promise<string> => {
    const payload: Record<string, unknown> = {
      from: params.from,
      to: params.to,
    };
    if (params.criterion) payload.criterion = params.criterion;
    if (params.k && params.k > 1) payload.k = params.k;
    if (params.index) payload.index = params.index;
    if (params.closedConnections && params.closedConnections.length > 0) {
      payload.closedConnections = params.closedConnections;
    }
    const res = await fetch("/api/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    return res.text();
  },
};
