# MetroFlow 2.0 — Resumen de sesión

Fechas: 19/10/2026–20/10/2026 · **Estado: TERMINADO (fases 1–6 completas y verificadas).**

## Objetivo
Evolucionar **MetroFlow** hacia **MetroFlow 2.0** siguiendo el manual de referencia:
1. Coherencia algorítmica de la traza (grafo de estados `(estación, línea)`). ✅
2. Laboratorio interactivo: eventos reales, pseudocódigo, reproducción paso a paso. ✅
3. Rediseño visual editorial + vista esquemática octolinear. ✅
4. Simulador de incidencias con `closedConnections` aislado por solicitud (backend + UI). ✅
5. Utilidades: buscador, URL compartible, historial, vista textual accesible. ✅
6. Verificación integral: doctest, `tsc`, build Vite, API en vivo, verificación visual. ✅

Informe completo: **`docs/INFORME_FINAL_2.0.md`** (con evidencia en `docs/evidencia/`, 12 capturas).

## Qué quedó implementado (front)
- `frontend/src/app.ts` — orquestación: 3 modos (plan/lab/incident), autocalculado por URL, buscador (Ctrl+K, sin tildes), sim de incidencias (clic en tramos, `x=12-13` en URL), historial/pins, vista textual, export, `aria-live`.
- `frontend/src/lab.ts` — `LabController`: marcos desde `/api/trace` (`events`), pseudocódigo dijkstra/BFS con mapeo evento→líneas, narración, controles (play/pausa/±/slider/velocidad), estadísticas progresivas.
- `frontend/src/map.ts` — vista geo/esquemática, estados del lab (settled/frontier/explored/d-labels/camino), marcas X de cierre, hit-áreas de tramo, táctil corregido (`touch-action`), etiquetas geo con criterio de jerarquía y lado alternado.
- `frontend/src/schematic.ts` — tabla de layout octolineal documentada (retícula 48px, OX=116, OY=52, lienzo 948×1118) con excepciones (San Antonio ↑diag, Parque Berrío ←).
- `frontend/src/api.ts` — cliente tipado con `Connection.id`, campos extra de eventos, `closedConnections` en route/trace/export.
- `styles/main.css` — capa 2.0 editorial (Georgia, reglas 2px, tabs, overlays, lab, incidentes, responsive, `prefers-reduced-motion`, print).

## Backend (sesión anterior, estable)
- Traza coherente: `TraceEvent` con `fromLine`/`previousFrom{,Line}`; `dijkstraTrace`/`bfsTrace` → `TraceResult`.
- `closedConnections` por solicitud: `readClosedConnections` + `graphForRequest` en `api_main.cpp` (grafo de trabajo, no se muta el compartido); `id` por conexión en `/api/graph`.
- `edgeJson` con `id`; export incluye `closedConnections` con metadatos.

## Verificación final (todas verde)
- Backend: `build.ps1 -Run` → **18 casos / 64 aserciones doctest OK**.
- API (`:18080`): ruta normal Bello→Aguacatala 25.5 min; cierre Universidad↔Hospital → desvío O→B 56 min/3 transbordos; cierre Tricentenario↔Caribe → `found=false`; 10 pares alternados sin contaminación del grafo; traza `path` == legs de la ruta; export con escenario.
- Frontend: `npx tsc --noEmit` OK; `npm run build` OK (26.77 kB CSS / 68.67 kB JS).
- Visual: Chrome headless + `scripts/cdp_shot.mjs` (CDP, con acciones JS reales y tamaños móviles); capturas en `docs/evidencia/`.

## Bugs corregidos en esta sesión
1. `Number(null)=0` fijaba desde/desde=Niquía al abrir sin URL → aplicar solo parámetros presentes.
2. Autocalculado faltante en modo plan al cargar con `?o&d`.
3. `scrollIntoView` del lab desplazaba la página → scroll contenido a la lista.
4. Etiquetas geo sobrepuestas (intercambios Metroplús) → criterio jerárquico + lado alternado.
5. Esquemático pequeño/recortado → padding, columna ancha por `data-view`, alto `calc(100vh-118px)`, choque San Antonio/Parque Berrío resuelto.
6. Marcas X pequeños → 8px/3.2 grosor (posición verificada numéricamente).
7. Tabs móviles truncadas → 10px/0.08em en ≤720px.
8. Eliminado `findIndex` muerto.

## Para correr
```powershell
pwsh -NoProfile -File build.ps1 -Serve      # API en :18080 (sirve frontend/dist)
cd frontend; npm run build                  # build final
node scripts/cdp_shot.mjs <url> <out.png> "[js]" [390x844]   # evidencia visual
```

## Limitaciones conocidas (resumen)
- Róces leves posibles entre etiquetas rotadas en el clúster San Antonio (esquemático). entre etiquetas rotadas en el clúster San Antonio (esquemático).
- Lab: la UI deriva estadísticas desde eventos (correcto pero sin contra-verificación contra `stats` del backend en pantalla).
- Sin E2E automatizado de UI; visual verificado manualmente-asistido por CDP.

Diseño y desarrollo — **samirjosegil**
