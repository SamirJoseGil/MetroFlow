#!/usr/bin/env python3
"""MetroFlow - generador de datos de red.

Produce data/stations.json y data/connections.json a partir de las lineas del
SITVA (Sistema Integrado de Transporte del Valle de Aburra) modeladas como un
grafo ponderado dirigido:

  * Linea A (Metro)          Niquia -> La Estrella       (21 estaciones)
  * Linea B (Metro)          San Antonio -> San Javier   (7 estaciones)
  * Linea T (Tranvia)        San Antonio -> Oriente      (9 estaciones)
  * Linea K (Metrocable)     Acevedo -> Santo Domingo    (4 estaciones)
  * Linea J (Metrocable)     San Javier -> La Aurora     (4 estaciones)
  * Linea H (Metrocable)     Oriente -> Villa Sierra     (3 estaciones)
  * Linea M (Metrocable)     Miraflores -> Trece Nov.    (3 estaciones)
  * Linea O (Metroplus BRT)  Caribe -> La Palma          (14 estaciones)

Fuentes de los datos:
  * Orden de estaciones e integraciones: Anexo de estaciones del SITVA y los
    articulos de cada linea (Wikipedia en espanol) y metrodemedellin.gov.co.
  * Coordenadas WGS84 de las lineas de Metro, Tranvia, Metrocables y de los
    extremos (Caribe, Floresta, La Palma) verificadas con la API de coordenadas
    de Wikipedia. Las estaciones intermedias de la Linea O (Metroplus, "bus de
    la 80") NO tienen coordenada publicada fiable, por lo que se estiman a lo
    largo del corredor real Carrera 65/80 y se marcan como "approx": true.

Decision de modelado (supuesto documentado, NO dato en vivo):
  tiempo_min = distancia_haversine / velocidad_comercial, redondeado a 0.5 min.
  Velocidades comerciales calibradas contra tiempos publicados:
    A = 38 km/h, B = 21.5 km/h, T = 30 km/h, Metrocables = 18 km/h,
    Metroplus O = 16 km/h (velocidad media publicada para la Linea O).
  El tiempo de transbordo (cambio de linea) es un parametro del modelo.

Uso:
    python scripts/generate_data.py
"""

from __future__ import annotations

import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"

# Velocidad comercial asumida por linea (km/h). Ver nota del encabezado.
COMMERCIAL_SPEED_KMH = {
    "A": 38.0,
    "B": 21.5,
    "T": 30.0,
    "K": 18.0,
    "J": 18.0,
    "H": 18.0,
    "M": 18.0,
    "O": 16.0,
}
TRANSFER_PENALTY_MIN = 3.0
MIN_SEGMENT_MIN = 1.0

LINES = [
    {"id": "A", "name": "Línea A (Metro)", "mode": "metro", "color": "#2F6FED"},
    {"id": "B", "name": "Línea B (Metro)", "mode": "metro", "color": "#F5A623"},
    {"id": "T", "name": "Línea T (Tranvía)", "mode": "tranvia", "color": "#16A34A"},
    {"id": "K", "name": "Línea K (Metrocable)", "mode": "cable", "color": "#EF4444"},
    {"id": "J", "name": "Línea J (Metrocable)", "mode": "cable", "color": "#8B5CF6"},
    {"id": "H", "name": "Línea H (Metrocable)", "mode": "cable", "color": "#EC4899"},
    {"id": "M", "name": "Línea M (Metrocable)", "mode": "cable", "color": "#0EA5E9"},
    {"id": "O", "name": "Línea O (Metroplús)", "mode": "brt", "color": "#14B8A6"},
]

# Cada linea es una lista ordenada de estaciones.
# Formato: (nombre, lat, lng, municipio, posicion, terminal, approx)
# approx=True solo en las estaciones intermedias de la Linea O (ver encabezado).

LINE_A = [
    ("Niquía",         6.33778, -75.54444, "Bello",     "elevada",   True,  False),
    ("Bello",          6.33028, -75.55361, "Bello",     "a nivel",   False, False),
    ("Madera",         6.31583, -75.55528, "Bello",     "a nivel",   False, False),
    ("Acevedo",        6.30028, -75.55833, "Medellín",  "a nivel",   False, False),
    ("Tricentenario",  6.29028, -75.56472, "Medellín",  "a nivel",   False, False),
    ("Caribe",         6.27833, -75.56944, "Medellín",  "a nivel",   False, False),
    ("Universidad",    6.26944, -75.56583, "Medellín",  "elevada",   False, False),
    ("Hospital",       6.26389, -75.56333, "Medellín",  "elevada",   False, False),
    ("Prado",          6.25694, -75.56611, "Medellín",  "elevada",   False, False),
    ("Parque Berrío",  6.25028, -75.56833, "Medellín",  "elevada",   False, False),
    ("San Antonio",    6.24722, -75.56972, "Medellín",  "elevada",   False, False),
    ("Alpujarra",      6.24306, -75.57139, "Medellín",  "elevada",   False, False),
    ("Exposiciones",   6.23861, -75.57306, "Medellín",  "elevada",   False, False),
    ("Industriales",   6.23000, -75.57556, "Medellín",  "a nivel",   False, False),
    ("Poblado",        6.21222, -75.57806, "Medellín",  "a nivel",   False, False),
    ("Aguacatala",     6.19417, -75.58167, "Medellín",  "a nivel",   False, False),
    ("Ayurá",          6.18611, -75.58611, "Envigado",  "a nivel",   False, False),
    ("Envigado",       6.17472, -75.59694, "Itagüí",    "a nivel",   False, False),
    ("Itagüí",         6.16306, -75.60667, "Itagüí",    "a nivel",   False, False),
    ("Sabaneta",       6.15778, -75.61611, "Sabaneta",  "a nivel",   False, False),
    ("La Estrella",    6.15278, -75.62667, "Sabaneta",  "soterrada", True,  False),
]

LINE_B = [
    ("San Antonio",    6.24722, -75.56972, "Medellín",  "elevada",   False, False),
    ("Cisneros",       6.24917, -75.57528, "Medellín",  "elevada",   False, False),
    ("Suramericana",   6.25306, -75.58306, "Medellín",  "elevada",   False, False),
    ("Estadio",        6.25333, -75.58833, "Medellín",  "elevada",   False, False),
    ("Floresta",       6.25861, -75.59778, "Medellín",  "elevada",   False, False),
    ("Santa Lucía",    6.25806, -75.60389, "Medellín",  "elevada",   False, False),
    ("San Javier",     6.25694, -75.61389, "Medellín",  "a nivel",   True,  False),
]

# Tranvia de Ayacucho: San Antonio -> Oriente (coordenadas verificadas).
LINE_T = [
    ("San Antonio",            6.24722, -75.56972, "Medellín", "a nivel", False, False),
    ("San José",               6.24732, -75.56539, "Medellín", "a nivel", False, False),
    ("Pabellón del Agua EPM",  6.24557, -75.56199, "Medellín", "a nivel", False, False),
    ("Bicentenario",           6.24395, -75.55878, "Medellín", "a nivel", False, False),
    ("Buenos Aires",           6.24141, -75.55391, "Medellín", "a nivel", False, False),
    ("Miraflores",             6.24139, -75.54889, "Medellín", "a nivel", False, False),
    ("Loyola",                 6.23903, -75.54518, "Medellín", "a nivel", False, False),
    ("Alejandro Echavarría",   6.23549, -75.54175, "Medellín", "a nivel", False, False),
    ("Oriente",                6.23323, -75.54014, "Medellín", "a nivel", True,  False),
]

LINE_K = [
    ("Acevedo",        6.30028, -75.55833, "Medellín", "teleférico", False, False),
    ("Andalucía",      6.29633, -75.55182, "Medellín", "teleférico", False, False),
    ("Popular",        6.29515, -75.54810, "Medellín", "teleférico", False, False),
    ("Santo Domingo",  6.29319, -75.54174, "Medellín", "teleférico", True,  False),
]

LINE_J = [
    ("San Javier",     6.25694, -75.61389, "Medellín", "teleférico", False, False),
    ("Juan XXIII",     6.26569, -75.61370, "Medellín", "teleférico", False, False),
    ("Vallejuelos",    6.27536, -75.61400, "Medellín", "teleférico", False, False),
    ("La Aurora",      6.28111, -75.61420, "Medellín", "teleférico", True,  False),
]

LINE_H = [
    ("Oriente",        6.23323, -75.54014, "Medellín", "teleférico", False, False),
    ("Las Torres",     6.23666, -75.53632, "Medellín", "teleférico", False, False),
    ("Villa Sierra",   6.23490, -75.52876, "Medellín", "teleférico", True,  False),
]

LINE_M = [
    ("Miraflores",          6.24139, -75.54889, "Medellín", "teleférico", False, False),
    ("El Pinal",            6.24532, -75.54440, "Medellín", "teleférico", False, False),
    ("Trece de Noviembre",  6.24750, -75.54111, "Medellín", "teleférico", True,  False),
]

# Metroplus Linea O ("bus de la 80"): Caribe -> La Palma bordeando la Av. 80.
# Extremos (Caribe, Floresta, La Palma) verificados; intermedias aproximadas.
LINE_O = [
    ("Caribe",                 6.27833, -75.56944, "Medellín", "a nivel", False, False),
    ("Cementerio Universal",   6.27500, -75.58000, "Medellín", "a nivel", False, True),
    ("Córdoba",                6.27300, -75.58600, "Medellín", "a nivel", False, True),
    ("Pilarica",               6.27000, -75.59200, "Medellín", "a nivel", False, True),
    ("Ciudadela Universitaria",6.26700, -75.59300, "Medellín", "a nivel", False, True),
    ("Facultad de Minas",      6.26450, -75.59300, "Medellín", "a nivel", False, True),
    ("Los Colores",            6.26200, -75.59000, "Medellín", "a nivel", False, True),
    ("Calasanz",               6.25950, -75.59350, "Medellín", "a nivel", False, True),
    ("Floresta",               6.25861, -75.59778, "Medellín", "a nivel", False, False),
    ("Los Pinos",              6.25200, -75.59850, "Medellín", "a nivel", False, True),
    ("Laureles",               6.24700, -75.59900, "Medellín", "a nivel", False, True),
    ("Santa Gema",             6.24200, -75.59950, "Medellín", "a nivel", False, True),
    ("Villa de Aburrá",        6.23650, -75.60020, "Medellín", "a nivel", False, True),
    ("La Palma",               6.231125, -75.601042, "Medellín", "a nivel", True, True),
]

LINE_SEQUENCES = {
    "A": LINE_A,
    "B": LINE_B,
    "T": LINE_T,
    "K": LINE_K,
    "J": LINE_J,
    "H": LINE_H,
    "M": LINE_M,
    "O": LINE_O,
}

# Integraciones informativas entre lineas (no generan aristas adicionales).
INTERCHANGES = {
    "Acevedo": ["K"],
    "Caribe": ["O"],
    "Hospital": ["1 (Metroplús)"],
    "San Antonio": ["A", "B", "T"],
    "Industriales": ["1 (Metroplús)", "2 (Metroplús)"],
    "Cisneros": ["1 (Metroplús)"],
    "San Javier": ["J"],
    "Floresta": ["O"],
    "Miraflores": ["M"],
    "Oriente": ["H"],
    "San José": ["2 (Metroplús)"],
    "La Palma": ["1 (Metroplús)", "2 (Metroplús)"],
}


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371.0088
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def round_half(x: float) -> float:
    return round(x * 2) / 2


def main() -> None:
    stations: list[dict] = []
    index: dict[str, int] = {}

    def add_station(name, lat, lng, municipio, posicion, terminal, approx, line_id):
        if name in index:
            sid = index[name]
            if line_id not in stations[sid]["lines"]:
                stations[sid]["lines"].append(line_id)
            stations[sid]["terminal"] = stations[sid]["terminal"] or terminal
            return sid
        sid = len(stations)
        index[name] = sid
        stations.append({
            "id": sid,
            "name": name,
            "lines": [line_id],
            "lat": lat,
            "lng": lng,
            "municipio": municipio,
            "position": posicion,
            "terminal": terminal,
            "approx_coords": approx,
            "interchanges": INTERCHANGES.get(name, []),
        })
        return sid

    # Se conserva el orden historico A, B para mantener estables los ids 0..26.
    for line_id, seq in LINE_SEQUENCES.items():
        for name, lat, lng, muni, pos, term, approx in seq:
            add_station(name, lat, lng, muni, pos, term, approx, line_id)

    connections: list[dict] = []

    def add_line_edges(seq, line_id):
        speed = COMMERCIAL_SPEED_KMH[line_id]
        for (n1, la1, lo1, *_), (n2, la2, lo2, *_) in zip(seq, seq[1:]):
            dist = haversine_km(la1, lo1, la2, lo2)
            t = max(MIN_SEGMENT_MIN, round_half(dist / speed * 60.0))
            u, v = index[n1], index[n2]
            for a, b in ((u, v), (v, u)):
                connections.append({"from": a, "to": b, "line": line_id,
                                    "time_min": t, "distance_km": round(dist, 3),
                                    "type": "travel", "available": True})

    for line_id, seq in LINE_SEQUENCES.items():
        add_line_edges(seq, line_id)

    stations_doc = {
        "meta": {
            "source": "Wikipedia (anexo de estaciones del SITVA y articulos por "
                      "linea) y metrodemedellin.gov.co; coordenadas via la API de "
                      "coordenadas de Wikipedia (WGS84).",
            "verified": "Orden e integraciones verificadas. Coordenadas de Metro, "
                        "Tranvia, Metrocables y extremos de la Linea O verificadas; "
                        "estaciones intermedias de la Linea O aproximadas "
                        "(approx_coords = true).",
            "coordinate_system": "WGS84 (lat, lng).",
        },
        "lines": LINES,
        "stations": stations,
    }
    connections_doc = {
        "meta": {
            "time_model": "Supuesto del modelo: tiempo_min = distancia_haversine"
                          " / velocidad_comercial, redondeado a 0.5 min. NO es un "
                          "dato de operacion en vivo.",
            "commercial_speed_kmh": COMMERCIAL_SPEED_KMH,
            "transfer_penalty_min": TRANSFER_PENALTY_MIN,
            "graph": "Digrafo ponderado; cada tramo fisico genera dos aristas "
                     "(ida y vuelta) con igual peso.",
            "transfer_note": "El transbordo no es una arista: se modela como "
                             "penalizacion al cambiar de linea en el estado "
                             "(estacion, linea).",
        },
        "transfer_penalty_min": TRANSFER_PENALTY_MIN,
        "connections": connections,
    }

    DATA.mkdir(parents=True, exist_ok=True)
    (DATA / "stations.json").write_text(
        json.dumps(stations_doc, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8")
    (DATA / "connections.json").write_text(
        json.dumps(connections_doc, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8")

    total_km = sum(c["distance_km"] for c in connections) / 2
    print(f"stations: {len(stations)}")
    print(f"directed connections: {len(connections)} "
          f"({len(connections)//2} undirected segments)")
    print(f"network length (sum of segments): {total_km:.2f} km")


if __name__ == "__main__":
    main()
