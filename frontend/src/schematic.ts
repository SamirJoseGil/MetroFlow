import type { Graph, Station } from "./api";
import type { Point } from "./projection";

/**
 * Vista esquemática de la red (diagrama de transporte octoilíneo).
 *
 * Las coordenadas son un LAYOUT AUTORADO y DETERMINISTA en unidades de rejilla
 * (no deriva de los datos geográficos, por lo que es estable entre renders y
 * entre estados de la interfaz): cada estación ocupa una casilla {gx, gy} y las
 * conexiones se dibujan como segmentos horizontales, verticales o a 45°.
 *
 * Reglas documentadas del layout:
 *  - Línea A: eje vertical central (espalda dorsal de la red, de N a S).
 *  - Línea B: ramal oeste de San Antonio en la fila y=11.
 *  - Línea O: rama oeste (fila y=6), bajada vertical x=0 y ramal sur x=0.
 *  - Línea T: ramal este de San Antonio (fila y=11).
 *  - Líneas K/J/H/M: ramales diagonales o verticales cortos.
 *  - Niquía/Andalucía/Popular/Las Torres se resuelven con diagonales 45°.
 *  - No se inventa topología: la adyacencia es exactamente connections.json.
 *  - Las transbordos comparten una única casilla (identidad física única).
 */
const SCHEMATIC_UNITS: ReadonlyArray<[number, number, number]> = [
  // gx, gy, stationId
  [5, 1, 0], // Niquía
  [4, 2, 1], // Bello
  [4, 3, 2], // Madera
  [4, 4, 3], // Acevedo (integración K)
  [4, 5, 4], // Tricentenario
  [4, 6, 5], // Caribe (integración O)
  [4, 7, 6], // Universidad
  [4, 8, 7], // Hospital
  [4, 9, 8], // Prado
  [4, 10, 9], // Parque Berrío
  [4, 11, 10], // San Antonio (integración A/B/T)
  [4, 12, 11], // Alpujarra
  [4, 13, 12], // Exposiciones
  [4, 14, 13], // Industriales
  [4, 15, 14], // Poblado
  [4, 16, 15], // Aguacatala
  [4, 17, 16], // Ayurá
  [4, 18, 17], // Envigado
  [4, 19, 18], // Itagüí
  [4, 20, 19], // Sabaneta
  [4, 21, 20], // La Estrella
  [3, 11, 21], // Cisneros
  [2, 11, 22], // Suramericana
  [1, 11, 23], // Estadio
  [0, 11, 24], // Floresta (integración B/O, esquina)
  [-1, 11, 25], // Santa Lucía
  [-2, 11, 26], // San Javier (integración B/J, esquina)
  [5, 11, 27], // San José
  [6, 11, 28], // Pabellón del Agua EPM
  [7, 11, 29], // Bicentenario
  [8, 11, 30], // Buenos Aires
  [9, 11, 31], // Miraflores (integración T/M, esquina)
  [10, 11, 32], // Loyola
  [11, 11, 33], // Alejandro Echavarría
  [12, 11, 34], // Oriente (integración T/H, esquina)
  [5, 3, 35], // Andalucía (diagonal desde Acevedo)
  [6, 2, 36], // Popular
  [8, 2, 37], // Santo Domingo
  [-2, 12, 38], // Juan XXIII
  [-2, 13, 39], // Vallejuelos
  [-2, 14, 40], // La Aurora
  [13, 10, 41], // Las Torres
  [14, 9, 42], // Villa Sierra
  [9, 10, 43], // El Pinal
  [9, 9, 44], // Trece de Noviembre
  [3, 6, 45], // Cementerio Universal
  [2, 6, 46], // Córdoba
  [1, 6, 47], // Pilarica
  [0, 7, 48], // Ciudadela Universitaria (diagonal desde Pilarica)
  [0, 8, 49], // Facultad de Minas
  [0, 9, 50], // Los Colores
  [0, 10, 51], // Calasanz
  [0, 12, 52], // Los Pinos
  [0, 13, 53], // Laureles
  [0, 14, 54], // Santa Gema
  [0, 15, 55], // Villa de Aburrá
  [0, 16, 56], // La Palma
];

export const SCHEMATIC_GEO: Record<number, Point> = Object.fromEntries(
  SCHEMATIC_UNITS.map(([gx, gy, id]) => [id, { x: gx, y: gy }]),
);

/** Tamaño de casilla y origen del diagrama en px del viewBox. */
const U = 48;
const OX = 116;
const OY = 52;

export const SCHEMATIC_VIEW = { width: 948, height: 1118, unit: U };

const PX: Record<number, Point> = Object.fromEntries(
  SCHEMATIC_UNITS.map(([gx, gy, id]) => [id, { x: OX + gx * U, y: OY + gy * U }]),
);

export function schematicPoints(): Map<number, Point> {
  return new Map(Object.entries(PX).map(([k, v]) => [Number(k), v]));
}

export type Axis = "column" | "row" | "diag";

export interface LabelPlacement {
  /** Desplazamiento del punto de anclaje, en px, antes de la rotación. */
  dx: number;
  dy: number;
  /** Rotación en grados alrededor del anclaje. */
  rotate: number;
  anchor: "start" | "middle" | "end";
  axis: Axis;
}

/**
 * Clasifica cada estación por la dirección de sus vecinos en su línea
 * principal y determina la colocación de la etiqueta: a la derecha de los
 * ejes verticales, en diagonal alterna (45°) en las filas horizontales y
 * en diagonal para los ramales diagonales.
 */
function axisOf(graph: Graph, station: Station): Axis {
  const primary = station.lines[0] ?? "A";
  const pos = SCHEMATIC_GEO[station.id];
  for (const c of graph.connections) {
    if (c.line !== primary) continue;
    const other = c.from === station.id ? c.to : c.to === station.id ? c.from : -1;
    if (other < 0) continue;
    const o = SCHEMATIC_GEO[other];
    if (!o) continue;
    if (o.x === pos.x) return "column";
    if (o.y === pos.y) return "row";
    return "diag";
  }
  return "column";
}

export function schematicLabelPlacements(
  graph: Graph,
): Map<number, LabelPlacement> {
  const placements = new Map<number, LabelPlacement>();
  for (const s of graph.stations) {
    const axis = axisOf(graph, s);
    let p: LabelPlacement;
    if (axis === "column") {
      // Etiqueta a la derecha del eje; lectura horizontal limpia.
      p = { dx: 10, dy: 4, rotate: 0, anchor: "start", axis };
    } else {
      // Filas y diagonales: texto en 45°, alternando hacia arriba y abajo
      // según paridad del id para separar etiquetas consecutivas.
      const low = s.id % 2 === 0;
      p = {
        dx: 7,
        dy: low ? -8 : 13,
        rotate: low ? -45 : 45,
        anchor: "start",
        axis,
      };
    }
    if (s.id === 10) {
      // San Antonio: tres líneas convergen (A/B/T). La etiqueta se cuela en
      // el cuadrante interior vacío (a la derecha del eje A, sobre la fila
      // B/T), en diagonal ascendente, lejos del cruce y de San José.
      p = { dx: 14, dy: -12, rotate: -45, anchor: "start", axis: "diag" };
    }
    if (s.id === 9) {
      // Parque Berrío: a la izquierda del eje y por debajo de su casilla,
      // separada de San Antonio (que sube por el otro lado del eje).
      p = { dx: -10, dy: 12, rotate: 0, anchor: "end", axis: "column" };
    }
    placements.set(s.id, p);
  }
  return placements;
}
