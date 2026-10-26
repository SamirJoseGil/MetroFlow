# MetroFlow

Planificador de rutas sobre la red de transporte del Valle de Aburrá (SITVA).
El proyecto tiene tres capas independientes:

1. **Motor de algoritmos en C++** (sin dependencias externas): grafo, Dijkstra,
   BFS, rutas alternativas y trazas paso a paso.
2. **API HTTP en C++** (Crow) que expone el motor como JSON y sirve el frontend
   compilado.
3. **Frontend en TypeScript + Vite + SVG** (sin framework) que dibuja la red y
   consume la API.

> Autor de la interfaz y la identidad visual: **samirjosegil**.

---

## Requisitos

| Herramienta | Versión usada | Notas |
|---|---|---|
| `g++` (MSYS2 / UCRT64) | 15.2.0 | Debe estar en el `PATH`. |
| Node.js / npm | 22.x / 10.x | Solo para el frontend. |
| PowerShell | 7+ | Para `build.ps1`. |

No se requiere CMake: la compilación se hace con `g++` directo desde `build.ps1`.

---

## Compilar y ejecutar

Desde la raíz del repositorio:

```powershell
./build.ps1            # compila el CLI y las pruebas
./build.ps1 -Run       # compila y ejecuta las pruebas (18 casos, 64 aserciones)
./build.ps1 -Api       # compila además el servidor API
./build.ps1 -Serve     # compila el API y lo deja corriendo en http://localhost:18080
./build.ps1 -All       # CLI + pruebas + API
```

Artefactos en `build/`: `metroflow_cli.exe`, `metroflow_tests.exe`,
`metroflow_api.exe`.

### Frontend (modo desarrollo)

```powershell
cd frontend
npm ci          # instalación reproducible desde package-lock.json
npm run dev     # servidor de desarrollo en http://localhost:5173 (proxy /api -> :18080)
npm run build   # typecheck (tsc --noEmit) + build de producción en frontend/dist
```

`npm run dev` necesita que la API esté en ejecución (`./build.ps1 -Serve`), porque
el proxy redirige `/api` a `http://localhost:18080`.

### Frontend (modo producción, servido por la API)

Tras `npm run build`, la API detecta `frontend/dist` y sirve la aplicación en la
raíz `/` (con *fallback* SPA). Entonces basta con `./build.ps1 -Serve` y abrir
`http://localhost:18080`.

---

## API HTTP

Base: `http://localhost:18080`.

| Método | Ruta | Cuerpo / parámetros | Devuelve |
|---|---|---|---|
| `GET` | `/api/health` | — | `{"status":"ok"}` |
| `GET` | `/api/stations` | — | Solo estaciones: `{stationCount, lines, stations}` |
| `GET` | `/api/graph` | — | Grafo completo: estaciones + conexiones (`edgeCount`, `transferPenaltyMin`) |
| `POST` | `/api/route` | `{from, to, criterion?, k?}` | Una ruta (`criterion: "time"`\|`"hops"`); si `k > 1`, arreglo de rutas alternativas |
| `POST` | `/api/trace` | `{from, to, criterion?}` | Traza paso a paso del algoritmo + estadísticas |
| `GET` | `/api/export` | — | Descarga del grafo como `metroflow_graph.json` |
| `POST` | `/api/export` | `{from, to, criterion?, k?, index?}` | Descarga del grafo **junto con la ruta** seleccionada como `metroflow_route.json` |

`from`/`to` aceptan el **id numérico** o el **nombre** de la estación (por
ejemplo `"0"` o `"Niquía"`). Errores devuelven `400` con un mensaje de texto.

Ejemplos:

```powershell
curl.exe -s -X POST http://localhost:18080/api/route `
  -H "Content-Type: application/json" `
  -d '{"from":"Niquia","to":"La Estrella","criterion":"time"}'

curl.exe -s -X POST http://localhost:18080/api/export `
  -H "Content-Type: application/json" `
  -d '{"from":0,"to":26,"k":3,"index":1}' -o metroflow_route.json
```

---

## Algoritmos y modelo de pesos

- **Dijkstra** sobre un estado `(estación, línea)`. Esto permite contabilizar el
  **transbordo** como parte del costo y no como una arista artificial.
- **BFS** (sin pesos) para el criterio de **menos paradas**.
- **Rutas alternativas**: aproximación tipo *Yen*; se ordenan por tiempo
  incluyendo la penalización de transbordo y **no** se garantiza que sean
  óptimas bajo ese criterio.
- **Trazas**: Dijkstra y BFS emiten eventos (`settle`, `relax`, `update_dist`,
  `update_parent`, …) que el frontend reproduce en el laboratorio paso a paso.

### Modelo de pesos (supuesto documentado)

`time_min = distancia_haversine / velocidad_comercial`, redondeado a **0.5 min**.

| Línea | Tipo | Velocidad comercial (km/h) |
|---|---|---|
| A, B | Metro | 38 / 21.5 |
| T | Tranvía | 30 |
| K, J, H, M | Cable | 18 |
| O | BRT | 16 |

Además se aplica una **penalización de transbordo de 3.0 min** al cambiar de
línea.

> **Estos tiempos son estimaciones** derivadas de la geometría y de supuestos de
> velocidad. **No** son datos de operación en vivo del sistema.

---

## Datos

- `data/stations.json`: 57 estaciones (8 líneas: A, B metro; T tranvía; K, J, H,
  M cable; O BRT) con coordenadas, municipio, tipo de posición e intercambios.
- `data/connections.json`: 114 conexiones dirigidas (57 tramos bidireccionales)
  con longitud, tiempo estimado, tipo y bandera `available`.

Las coordenadas de paradas intermedias de la **Línea O** están **interpoladas**
y marcadas con `approx_coords: true` en los datos: no son verificables.

`scripts/generate_data.py` regenera los archivos de datos a partir de las
coordenadas base.

---

## Estructura del repositorio

```
backend/
  include/        Cabeceras (Graph, Dijkstra, Bfs, RoutePlanner, DataLoader, Serialize, Trace)
  src/            Implementación + cli_main.cpp + api_main.cpp
  third_party/    Crow, asio, nlohmann/json (json.hpp)
frontend/
  index.html      Punto de entrada (tema aplicado antes del primer pintado)
  src/
    app.ts        Interfaz: planificador, resultados, alternativas, laboratorio
    map.ts        Mapa SVG: red, ruta activa, zoom/pan, capa de exploración
    api.ts        Cliente de la API
    theme.ts      Tema claro/oscuro persistente
    icons.ts      Iconos SVG en línea
    projection.ts Proyección equirectangular
    styles/       Hojas de estilo (identidad editorial monocromática)
  vite.config.ts  Proxy /api -> :18080, salida en dist/
data/             Datos de la red (JSON)
docs/styles/      Guía de estilo de referencia
scripts/          Generador de datos
tests/            Pruebas del motor (marco propio)
build.ps1         Compilación con g++
```

---

## Interfaz

La interfaz sigue una **identidad editorial monocromática** (tipografía serif,
etiquetas en versalitas, bordes rectos, alto contraste) manteniendo los colores
semánticos de cada línea de transporte. Incluye:

- Tema **claro/oscuro** persistente (respeta la preferencia del sistema).
- Mapa SVG con **zoom y desplazamiento**, resaltado de la ruta activa y un
  **laboratorio** que reproduce el algoritmo paso a paso sobre el grafo.
- Selección de **rutas alternativas** y **exportación** de la ruta junto al grafo.
- Diseño **accesible** (navegación por teclado, roles/etiquetas ARIA, respeto a
  `prefers-reduced-motion`) y **responsivo**.

---

## Pruebas

```powershell
./build.ps1 -Run
```

Cubren la construcción del grafo, rutas (Dijkstra/BFS), respeto de la bandera
`available` (tramos cerrados) y rutas alternativas.

---

## Limitaciones

- Tiempos y velocidades **estimados**, no datos de operación en vivo.
- Coordenadas intermedias de la Línea O **interpoladas**.
- Las rutas alternativas son una **aproximación** (no óptimas garantizadas).
- El frontend no se ha verificado visualmente en un navegador desde este entorno.

---

## Licencia

Uso académico. `samirjosegil` — identidad visual e interfaz.
