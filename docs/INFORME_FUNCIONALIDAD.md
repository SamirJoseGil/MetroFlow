# Informe de funcionalidad — MetroFlow

> Documento descriptivo del estado actual del proyecto. Se basa en la lectura
> del código y de los datos del repositorio; no documenta funciones inexistentes.
> Fecha: octubre de 2026.

---

## 1. Resumen ejecutivo

**MetroFlow** es un planificador de rutas para la red de transporte del Valle de
Aburrá (SITVA). Permite elegir origen y destino y obtener:

- la ruta de **menor tiempo** (Dijkstra),
- la ruta con **menos paradas** (BFS),
- una comparación entre ambos criterios,
- **rutas alternativas**,
- una **traza paso a paso** de la ejecución del algoritmo,
- la **exportación** del grafo junto con la ruta calculada.

La aplicación se organiza en tres capas independientes: un **motor de algoritmos
en C++**, una **API HTTP en C++ (Crow)** y un **frontend en TypeScript/Vite/SVG**
sin framework. La interfaz consume exclusivamente la API; el motor también puede
usarse por línea de comandos.

---

## 2. Arquitectura

```
┌──────────────────────────────────────────────────────────────┐
│ Frontend (TypeScript + Vite + SVG)                           │
│  app.ts · map.ts · api.ts · theme.ts · icons.ts · projection  │
└───────────────────────────────┬──────────────────────────────┘
                                │ HTTP/JSON  (fetch)
┌───────────────────────────────▼──────────────────────────────┐
│ API HTTP (Crow, C++17) — :18080                              │
│  /api/health · /api/stations · /api/graph                    │
│  /api/route · /api/trace · /api/export (GET/POST)            │
│  + servicio de estáticos de frontend/dist con fallback SPA   │
└───────────────────────────────┬──────────────────────────────┘
                                │ llamadas en proceso
┌───────────────────────────────▼──────────────────────────────┐
│ Motor (C++17, sin dependencias externas salvo nlohmann/json) │
│  Graph · Dijkstra · Bfs · RoutePlanner · DataLoader          │
│  Serialize · Trace                                            │
└───────────────────────────────┬──────────────────────────────┘
                                │ lectura al iniciar
                       data/stations.json
                       data/connections.json
```

- El **frontend** no conoce detalles internos del motor.
- La **API** y el **CLI** comparten exactamente el mismo motor y la misma
  serialización JSON (`Serialize.cpp`).
- Los datos se cargan una sola vez al arrancar la API (`DataLoader`).

---

## 3. Modelo de datos

### 3.1 Estación (`Station.hpp`)

| Campo | Tipo | Uso |
|---|---|---|
| `id` | `int` | Identificador secuencial (0..n-1). |
| `name` | `string` | Nombre visible y clave del mapa `nombre → id`. |
| `lines` | `vector<string>` | Líneas a las que pertenece (puede tener varias). |
| `lat`, `lng` | `double` | Coordenadas WGS84. |
| `municipio` | `string` | Agrupación usada en los selectores. |
| `position` | `string` | `elevada`, `a nivel`, `soterrada`, `teleférico`. |
| `terminal` | `bool` | Extremo de línea (se dibuja distinto). |
| `interchanges` | `vector<string>` | Líneas con las que conecta (marca de integración). |

Una estación **no se duplica por línea**: San Antonio, por ejemplo, es una sola
estación con las líneas A, B y T.

### 3.2 Conexión (`Edge.hpp`)

| Campo | Tipo | Uso |
|---|---|---|
| `from`, `to` | `int` | Estaciones extremas. |
| `line` | `string` | Línea del tramo (`A`, `B`, `T`, `K`, `J`, `H`, `M`, `O`). |
| `timeMin` | `double` | Peso principal (minutos estimados). |
| `distanceKm` | `double` | Distancia geográfica estimada. |
| `type` | `string` | Hoy siempre `travel`. |
| `available` | `bool` | Permite simular cierres de tramo. |

El grafo es **dirigido**: cada tramo físico genera dos aristas (ida y vuelta),
por eso hay 114 aristas para 57 tramos.

### 3.3 Grafo (`Graph.hpp`)

- `vector<Station>` — acceso contiguo por id.
- `unordered_map<string,int>` — nombre → id (O(1) medio).
- `vector<vector<int>>` — lista de adyacencia con **índices de arista**.
- `vector<Edge>` — todas las aristas.
- `transferPenaltyMin` — penalización de transbordo (3.0 min por defecto).

Complejidad de memoria: **O(V + E)**. Guardar índices (no copias) permite
prohibir aristas concretas, algo que necesita el cálculo de alternativas.

### 3.4 Ruta y traza

- `Route`: `found`, `stations` (ids), `legs` (`RouteLeg`), `transfers`, `stops`,
  `totalMin`, `totalKm`, `criterion`.
- `TraceEvent`: `type`, `node`, `from`, `dist`, `previous`, `line`, `note`.
- `AlgorithmStats`: `pushes`, `extractions`, `relaxations`, `updates`,
  `staleEntries`, `settledNodes`, `elapsedMs`.

Tipos de evento: `init`, `push`, `extract`, `skip`, `relax`, `update_dist`,
`update_parent`, `path`.

---

## 4. Datos de la red

Archivos: `data/stations.json` y `data/connections.json`.

- **57 estaciones**, **114 conexiones dirigidas** (57 tramos), **8 líneas**.
- **48.15 km** lineales totales.
- **9 terminales**, **12 estaciones de integración**.
- Municipios: Medellín (49), Bello (3), Itagüí (2), Sabaneta (2), Envigado (1).

| Línea | Servicio | Tramos | km | Tiempo estimado (ida) |
|---|---|---|---|---|
| A | Metro A | 20 | 24.17 | 38.5 min |
| B | Metro B | 6 | 5.19 | 14.5 min |
| T | Tranvía | 8 | 3.80 | 8.0 min |
| K | Metrocable K | 3 | 2.01 | 7.0 min |
| J | Metrocable J | 3 | 2.69 | 8.5 min |
| H | Metrocable H | 2 | 1.43 | 5.0 min |
| M | Metrocable M | 2 | 1.10 | 3.5 min |
| O | Metroplús (BRT) | 13 | 7.76 | 30.0 min |

### Procedencia y supuestos

- Orden e integraciones verificados; coordenadas de Metro, Tranvía, Metrocables
  y extremos de la Línea O verificadas.
- Las **12 paradas intermedias de la Línea O** tienen coordenadas interpoladas
  (`approx_coords: true`).
- Los tiempos son **estimaciones** (`haversine / velocidad comercial`,
  redondeadas a 0.5 min), **no** datos de operación en vivo.
- Velocidades comerciales asumidas: A 38, B 21.5, T 30, K/J/H/M 18, O 16 km/h.
- Penalización de transbordo: **3.0 min**.

---

## 5. Motor de algoritmos

### 5.1 Dijkstra (`Dijkstra.cpp`)

- Grafo con pesos no negativos.
- `std::priority_queue` como min-heap.
- **Lazy deletion**: descarta entradas obsoletas (`skip`).
- Parada temprana al asentar el destino (`target >= 0`).
- Complejidad **O((V + E) log V)**.
- Variante `computeFiltered` con **aristas y nodos prohibidos**, usada por Yen.
- **Ignora aristas con `available = false`** (tramos cerrados).
- Emite traza opcional.

### 5.2 Ruta más rápida con transbordos (`RoutePlanner::fastest`)

Dijkstra se ejecuta sobre el **grafo de estados `(estación, línea)`**, no sobre
estaciones. Así el costo depende de la línea actual: cambiar de línea suma la
penalización de 3 min. Sin este modelo, el transbordo no podría contabilizarse
correctamente.

- Los estados iniciales son las líneas de la estación origen (costo 0).
- El mejor estado de llegada es el de menor costo en el destino.
- `totalMin` reportado **incluye** la penalización por transbordo.
- Criterio reportado: `time_transfer_aware`.

### 5.3 Menos paradas (`RoutePlanner::fewestStops`)

- **BFS** con `std::queue<int>`; cada arista cuenta como un salto.
- Reconstruye la ruta con `parent` y `parentEdge`.
- `totalMin` se calcula con los tiempos reales (puede ser mayor que el óptimo de
  tiempo). Criterio reportado: `hops`.
- Complejidad **O(V + E)**.
- Ignora tramos cerrados.

### 5.4 Rutas alternativas (`RoutePlanner::alternatives`)

- Aproximación tipo **Yen** para las k rutas más cortas por tiempo.
- Prohíbe aristas y nodos para generar desvíos y elimina duplicados por
  secuencia de estaciones.
- Incorpora la ruta de `fastest()` como semilla y reordena todo por la **función
  objetivo real** (tiempo + transbordos).
- No garantiza optimalidad estricta bajo esa función; la interfaz lo advierte.
- Respeta `available`.

### 5.5 Trazas (`Trace`)

- Dijkstra y BFS registran eventos si `recordTrace = true`.
- El frontend los reproduce paso a paso y sincroniza el mapa.
- **Matiz importante:** la traza de “menor tiempo” usa el **Dijkstra clásico**
  (peso = tiempo, sin penalización de transbordo), mientras que `fastest()` usa
  el grafo de estados. Por eso la ruta explorada en el laboratorio puede diferir
  de la ruta final mostrada por “Calcular”.

### 5.6 Cierres de tramo

`available = false` se respeta en Dijkstra, BFS, `fastest()` y alternativas. Hoy
**no hay interfaz** para activar cierres: la bandera existe en los datos y en el
motor, pero todos los tramos están disponibles.

---

## 6. API HTTP (`backend/src/api_main.cpp`)

Base: `http://localhost:18080`.

| Método | Ruta | Cuerpo / parámetros | Respuesta |
|---|---|---|---|
| `GET` | `/api/health` | — | `{"status":"ok"}` |
| `GET` | `/api/stations` | — | `{stationCount, lines, stations}` (sin conexiones) |
| `GET` | `/api/graph` | — | `{transferPenaltyMin, lines, stationCount, edgeCount, stations, connections}` |
| `POST` | `/api/route` | `{from, to, criterion?, k?}` | `Route`; si `k > 1`, arreglo de `Route` |
| `POST` | `/api/trace` | `{from, to, criterion?}` | `{stats, events}` |
| `GET` | `/api/export` | — | Grafo como `metroflow_graph.json` |
| `POST` | `/api/export` | `{from, to, criterion?, k?, index?}` | Grafo + ruta + alternativas como `metroflow_route.json` |

Detalles:

- `from`/`to` aceptan **id numérico** o **nombre** de estación (`resolveId`).
- Validación de dígitos segura con `unsigned char` (evita UB con UTF-8).
- Errores: `400` con texto (`json inválido`, `campos from/to obligatorios`,
  `estación desconocida`).
- `criterion`: `"time"` (por defecto) o `"hops"`.
- Si `k > 1`, `/api/route` devuelve alternativas (sin `criterion`).
- El documento de exportación incluye `application`, `schema`
  (`metroflow.route.v1`), `exportedAt`, `criterion`, `from`, `to`,
  `transferPenaltyMin`, `route`, `graph` y `alternatives` si existen.
- Si existe `frontend/dist`, la API sirve la SPA en `/` y aplica **fallback SPA**
  para rutas del cliente, excluyendo `/api/*`.

---

## 7. CLI (`backend/src/cli_main.cpp`)

```
metroflow_cli [--data DIR] <comando> [opciones]

stations                         Lista id, nombre y líneas.
graph                            Grafo completo en JSON.
route --from X --to Y            Ruta (por tiempo por defecto).
      [--criterion hops]         Ruta con menos paradas.
      [--k N]                    N rutas alternativas.
      [--trace]                  Añade la traza del algoritmo.
compare --from X --to Y          Compara tiempo vs. paradas.
```

`--from`/`--to` aceptan id o nombre. Salida por `stdout` en JSON (salvo
`stations`, que es tabular).

---

## 8. Frontend: funcionalidad

Archivos clave: `frontend/src/app.ts` (interfaz y estado), `map.ts` (SVG),
`api.ts` (cliente HTTP), `theme.ts`, `icons.ts`, `projection.ts`.

### 8.1 Arranque

1. `index.html` aplica el tema antes del primer pintado.
2. `app.ts` muestra un estado de carga (“Cargando la red…”).
3. `GET /api/graph`; si falla, muestra un estado de error con instrucciones.
4. Construye `MapView` y el shell (cabecera, mapa, panel, resultados, pie).

### 8.2 Planificador

- Dos selectores agrupados por **municipio** (`<optgroup>`), ordenados
  alfabéticamente.
- Botón **Invertir** (intercambia origen/destino y recalcula).
- Selector de criterio: **Menor tiempo** / **Menos paradas** (radios).
- Botones: **Calcular**, **Comparar**, **Paso a paso**.
  - Comparar y Paso a paso se deshabilitan si origen/destino no son válidos.
  - Calcular se deshabilita si falta origen o destino.
- También se puede fijar origen y destino **haciendo clic en el mapa**:
  el primer clic fija origen; el segundo, destino; un tercer clic reinicia el
  origen. Si ambos quedan definidos, calcula automáticamente.

### 8.3 Calcular

- `POST /api/route` con el criterio elegido.
- Si no hay ruta: aviso y se limpia la ruta del mapa.
- Si hay ruta: se dibuja en el mapa, se muestran métricas y tramos.
- En paralelo (sin bloquear el resultado) se piden hasta **3 alternativas** por
  tiempo; si fallan, el resultado principal se mantiene.

### 8.4 Comparar

- `Promise.all` de `/api/route` con `time` y con `hops`.
- Dos paneles lado a lado (una columna en móvil).
- La ruta por tiempo se dibuja en el mapa.

### 8.5 Alternativas

- Tarjetas con tiempo, paradas, transbordos, km y distintivos de línea.
- Al seleccionar una, se actualiza el panel de detalle, el mapa y los parámetros
  de exportación.

### 8.6 Paso a paso (laboratorio)

- `POST /api/trace` con el criterio elegido.
- Métricas de ejecución: inserciones, extracciones, relajaciones,
  actualizaciones, descartes, nodos asentados y tiempo.
- Controles: reproducir/pausar, anterior, siguiente, reiniciar y deslizador.
- Lista de eventos que se auto-desplaza al evento activo.
- El mapa resalta el **nodo asentado** y la **arista explorada**.
- Limpia la ruta activa al entrar en modo laboratorio.

### 8.7 Exportar

- Botón “Exportar grafo + ruta”.
- `POST /api/export` con `from`, `to`, `criterion`, `k` e `index` según el estado.
- Descarga `metroflow_route.json` mediante `Blob` + `<a download>`.

### 8.8 Mapa

- Red base coloreada por línea y diferenciada por tipo de trazo.
- Zoom con rueda y botones; desplazamiento con arrastre.
- Estaciones clicables y navegables por teclado (Enter/Espacio).
- Marcadores distintos para integración, terminal, origen y destino.

### 8.9 Tema

- Claro/oscuro persistente en `localStorage` (`metroflow-theme`).
- Si no hay preferencia guardada, usa `prefers-color-scheme`.
- Botón en la cabecera; el CSS invierte los tokens.

### 8.10 Estados y concurrencia

- Estados de interfaz: carga, error, aviso, resultado, comparación, laboratorio.
- Un contador `runId` descarta respuestas obsoletas si el usuario relanza una
  operación antes de que termine la anterior.
- `aria-live` y `aria-busy` en la zona de resultados.

### 8.11 Persistencia

- Solo se persiste el **tema**. No hay cuentas, historial ni rutas guardadas;
  todo el estado vive en memoria y se pierde al recargar.

---

## 9. Compilación y ejecución

```powershell
./build.ps1            # CLI + pruebas
./build.ps1 -Run       # compila y ejecuta pruebas
./build.ps1 -Api       # añade la API
./build.ps1 -Serve     # compila la API y la deja corriendo (:18080)
./build.ps1 -All       # CLI + pruebas + API
```

Frontend:

```powershell
cd frontend
npm ci
npm run dev     # :5173 con proxy /api -> :18080
npm run build   # tsc --noEmit + vite build (frontend/dist)
```

Tras `npm run build`, la API sirve la SPA en `http://localhost:18080/`.

---

## 10. Pruebas

`tests/` usa un marco propio basado en doctest.

- **18 casos**, **64 aserciones**, todas en verde.
- Cubren:
  - construcción del grafo y validaciones,
  - Dijkstra vs. BFS (tiempo vs. saltos),
  - penalización de transbordo,
  - alternativas ordenadas,
  - origen = destino y grafo desconectado,
  - consistencia de la reconstrucción,
  - carga de la red real (57/114),
  - existencia de contrastes reales entre criterios,
  - **exclusión de tramos cerrados** en Dijkstra, BFS, `fastest` y alternativas.

---

## 11. Limitaciones y supuestos

1. **Tiempos estimados**, no operación en vivo.
2. **Coordenadas aproximadas** en 12 paradas intermedias de la Línea O.
3. **Alternativas aproximadas** (Yen), no optimalidad garantizada.
4. **La traza del laboratorio** usa Dijkstra clásico sin penalización; puede
   diferir de la ruta de “Calcular”.
5. **No hay UI de cierres** aunque el motor soporta `available`.
6. **Sin persistencia** de rutas, favoritos ni historial.
7. **Sin búsqueda** de estaciones: solo los selectores.
8. El mapa es **geográfico**, no esquemático; en el centro de Medellín puede
   haber congestión visual.
9. En táctil, el mapa captura el gesto (`touch-action: none`), lo que puede
   dificultar el desplazamiento de la página sobre el mapa.
10. El render visual no se ha validado en un navegador desde el entorno de
    desarrollo; las pruebas son de tipos, build y API.

---

## 12. Mapa de archivos clave

| Archivo | Responsabilidad |
|---|---|
| `backend/include/*.hpp` | Contratos del motor (grafo, ruta, traza, algoritmos). |
| `backend/src/Graph.cpp` | Construcción del grafo y adyacencia. |
| `backend/src/Dijkstra.cpp` | Dijkstra y variante filtrada. |
| `backend/src/Bfs.cpp` | BFS y traza. |
| `backend/src/RoutePlanner.cpp` | Ruta rápida con transbordos, pocas paradas, alternativas. |
| `backend/src/DataLoader.cpp` | Carga de JSON a `Graph`. |
| `backend/src/Serialize.cpp` | Serialización JSON (grafo, ruta, traza, export). |
| `backend/src/api_main.cpp` | API Crow y servicio de estáticos. |
| `backend/src/cli_main.cpp` | Interfaz de línea de comandos. |
| `tests/*.cpp` | Pruebas del motor. |
| `data/*.json` | Datos de la red y metadatos. |
| `frontend/src/app.ts` | Estado, shell, planificador, resultados, laboratorio. |
| `frontend/src/map.ts` | Dibujo SVG, ruta activa, zoom/pan, exploración. |
| `frontend/src/api.ts` | Cliente de la API y tipos. |
| `frontend/src/projection.ts` | Proyección geográfica al SVG. |
| `frontend/src/theme.ts` | Tema claro/oscuro persistente. |
| `frontend/src/icons.ts` | Iconos SVG en línea. |
| `frontend/src/styles/main.css` | Sistema visual completo. |
| `build.ps1` | Compilación con g++. |

---

## 13. Posibles mejoras funcionales (contexto)

- Interfaz para **abrir/cerrar tramos** (`available`).
- **Búsqueda** de estaciones y **favoritos**.
- **Enlace compartible** con origen, destino y criterio (query string).
- **Geolocalización** para sugerir el origen.
- **Horarios** o tiempo de espera por línea.
- **Vista de lista** accesible como alternativa al mapa.
- Unificar la traza del laboratorio con el modelo de estados para que coincida
  exactamente con la ruta de “Calcular”.
