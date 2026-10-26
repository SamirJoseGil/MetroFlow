import type { Station } from "./api";

export interface Point {
  x: number;
  y: number;
}

export interface Projection {
  width: number;
  height: number;
  points: Map<number, Point>;
}

const PAD = 48;

/**
 * Proyección equirectangular local ajustada para el Valle de Aburrá.
 * Mantiene la relación de aspecto real y centra el grafo en el SVG.
 */
export function project(
  stations: Station[],
  width = 680,
  height = 780,
): Projection {
  const points = new Map<number, Point>();

  if (!stations || stations.length === 0) {
    return { width, height, points };
  }

  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;

  for (const s of stations) {
    minLat = Math.min(minLat, s.lat);
    maxLat = Math.max(maxLat, s.lat);
    minLng = Math.min(minLng, s.lng);
    maxLng = Math.max(maxLng, s.lng);
  }

  // Factor Corrector de Latitud Media (Mercator Local)
  const midLat = ((minLat + maxLat) / 2) * (Math.PI / 180);
  const kx = Math.cos(midLat);

  // Amplitud geográfica escalada
  const spanX = (maxLng - minLng) * kx || 1e-6;
  const spanY = maxLat - minLat || 1e-6;

  // Área interior disponible descontando padding
  const innerW = width - PAD * 2;
  const innerH = height - PAD * 2;

  // Escala uniforme para evitar deformación de las líneas
  const scale = Math.min(innerW / spanX, innerH / spanY);

  // Centrado automático en ambos ejes
  const offX = PAD + (innerW - spanX * scale) / 2;
  const offY = PAD + (innerH - spanY * scale) / 2;

  for (const s of stations) {
    // Coordenada X proyectada
    const x = offX + (s.lng - minLng) * kx * scale;
    // Coordenada Y invertida (Latitud alta = Y menor en SVG)
    const y = offY + (maxLat - s.lat) * scale;

    points.set(s.id, {
      x: Number(x.toFixed(2)),
      y: Number(y.toFixed(2)),
    });
  }

  return { width, height, points };
}