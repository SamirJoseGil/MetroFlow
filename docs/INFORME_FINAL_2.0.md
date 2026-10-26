# MetroFlow 2.0 — Informe final

Fecha: 20/10/2026 · Sesión de cierre (fases 2–6 completadas sobre la fase 1).

## 1. Alcance

Se completó la evolución de MetroFlow a la versión 2.0 según el manual de referencia: **una sola aplicación, tres experiencias** (Planificador, Laboratorio, Incidencias) sobre **un mismo motor** (backend C++, API Crow, sin duplicación de lógica). La fase 1 (coherencia de la traza + `closedConnections` por solicitud) quedó terminada en la sesión previa; esta sesión implementó las fases 2 a 6 y su verificación integral.

## 2. Lo construido, fase por fase

### Fase 2 — Laboratorio del algoritmo (`frontend/src/lab.ts`, `app.ts`)
- `LabController` que consume `/api/trace` y construye **marcos de reproducción** desde los eventos reales del backend (`init|push|extract|skip|relax|update_dist|update_parent|path`; la clave JSON es `events`).
- **Pseudocódigo sincronizado**: cada tipo de evento mapea a líneas concretas de la función `dijkstra_estados(origen, destino)` (BFS tiene su propio pseudocódigo, sin bucles de relajación).
- **Narración** determinista por evento ("Se extrae el estado Bello [A] … asentado en d=0", "Se evalúa la conexión Prado → Hospital (línea A): candidato…").
- Controles: reproducir/pausar, anterior/siguiente, barra de progreso, velocidades 0.5×/1×/2×, salto directo.
- **Estadísticas progresivas** derivadas de los eventos (no del backend): asentados, frontera, evaluaciones, mejoras, transbordos.
- El camino BFS se reconstruye a partir de `pred` (BFS no emite eventos `path`); Dijkstra sí.
- En el mapa: estados asentados (relleno pleno), frontera (anillo discontinuo), aristas exploradas, etiquetas `d=…` y camino final animado.
- Corrección de usabilidad: el desplazamiento de la lista de eventos quedó contenido al panel (`scrollTop`) para no mover la página al cargar.

### Fase 3 — Rediseño visual editorial + vista esquemática (`schematic.ts`, `map.ts`, `styles/main.css`)
- **Sistema editorial**: titulares serif (Georgia), numeración de secciones («01 — Red»), reglas de 2px, grano tipográfico, `--mono`/`--serif`. Los colores de línea **siguen siendo semánticos** (A azul, B naranja, …) y el tema claro/oscuro respeta el sistema (`prefers-color-scheme` + botón).
- **Vista esquemática octolinear** (`schematic.ts`): tabla de posiciones en retícula de 48px, documento como dato (secciones/comentarios por línea), segmentos solo en 0°/90°/±45°. Etiquetas: a la derecha en ejes verticales, alternando arriba/abajo en ±45° en filas, con excepciones documentadas (San Antonio sube en diagonal; Parque Berrío a la izquierda del eje).
- **Vista geográfica depurada**: solo se rotulan terminales y transbordos reales (estación con >1 línea); las paradas con integración Metroplús conservan marcador y muestran rótulo al pasar el ratón o enfocar. Alternancia determinista de lado (arriba/abajo) para las etiquetas visibles.
- Animaciones justificadas y respaldo de `prefers-reduced-motion` (desactivación global).
- Gestos táctiles corregidos: `touch-action: pan-x pan-y pinch-zoom` en el lienzo; el arrastre del mapa queda solo para ratón/lápiz.

### Fase 4 — Simulador de incidencias (UI)
- Modo Incidencias con clic directo sobre el tramo del mapa (o sobre el símbolo «×» del recorrido resultante), lista de tramos cerrados con quitar, y **campo `closedConnections` real por solicitud** (los tramos se guardan como pares de estación `min:max` y se convierten a `connection.id` dirigidos antes de llamar a la API).
- **Comparación de impacto**: original vs escenario (Δ tiempo, distancia, paradas, transbordos) y caso de **desconexión** («Sin ruta disponible» con explicación), con llamado a recalcular y vaciar escenario.
- La marca de cierre se dibuja en el punto medio exacto del tramo con X en color de peligro, en ambas vistas.

### Fase 5 — Utilidades
- **Buscador incremental** (Ctrl+K o clic en origen/destino): insensible a tildes («niquia» → Niquía), por nombre y municipio, navegación con teclado, `aria-*` completo.
- **URL compartible**: `o,d,c,v,m,x` (vista, modo, criterio y tramos cerrados como `12-13`) aplicada en la carga y sincronizada con `replaceState`.
- **Historial local** y clics fijados (persistidos en `localStorage`).
- **Vista textual accesible**: secuencia numerada de estaciones, tramo a tramo con línea/tiempo/km y totales; anuncios por región `aria-live`.
- Exportación `/api/export` incluye el escenario de incidencia activo.

### Correcciones encontradas durante la verificación
1. `Number(null) === 0`: la URL sin parámetros fijaba origen/destino=Niquía (id 0). Corregido: solo se aplican parámetros presentes y válidos.
2. Falta de autocalculado: al cargar `?o=&d=` en modo Planificador no se lanzaba la ruta; añadido (igual que laboratorio/incidencias).
3. `scrollIntoView` del laboratorio movía la página entera al primer render; contenido al contenedor.
4. Etiquetas geográficas sobrepuestas (Cisneros/San José/Hospital/Industriales rotuladas por tener integración Metroplús): criterio afinado y lado alternado.
5. Esquemático: padding insuficiente (OX 104→116, OY 56→52, lienzo 948×1118), columna más ancha cuando `data-view="schem"`, y el choque de etiquetas San Antonio/Parque Berrío resuelto.
6. Marcas X de cierre demasiado pequeñas: tamaño 5→8, grosor 2.6→3.2.
7. Pestañas truncadas en móvil: tamaño/espaciado ajustados en ≤720px.
8. Eliminación de código muerto (`findIndex`).

## 3. Verificación (Fase 6)

### Backend — pruebas
- `pwsh -NoProfile -File build.ps1 -Run` → **18 casos / 64 aserciones doctest: SUCCESS** (coherencia ruta↔traza y aislamiento de cierres incluidos en la batería previa).

### API en vivo (`:18080`, servidor Crow)
- `/api/health` → `{"status":"ok"}`; `/api/graph`: 57 estaciones, 114 aristas, `id` por conexión (0..113, ambos sentidos).
- `/api/route` normal Bello(1)→Aguacatala(15): **25.5 min · 14 paradas · 0 transbordos**.
- Cierre por `closedConnections`:
  - `[12,13]` (Universidad↔Hospital) → desvío real por **O→B**: **56 min · 21 paradas · 3 transbordos**.
  - `[8,9]` (Tricentenario↔Caribe) → **`found=false`** (sin camino: cuello de botella), correcto.
- **Aislamiento por concurrencia**: 10 pares alternados normal/escenario → el normal siempre 25.5 min y el escenario siempre 56 min: el grafo compartido no se muta.
- `/api/trace`: 209 eventos Dijkstra y 200 BFS; **los `path` de la traza coinciden tramo a tramo con los `legs` de `/api/route`** (coherencia).
- `/api/export`: incluye `closedConnections` (con metadatos) a nivel raíz.

### Frontend — `npx tsc --noEmit` + `npm run build`
- TypeScript sin errores; Vite OK (**26.77 kB CSS / 68.67 kB JS**, gzip ≈ 5.95/20.89 kB).

### Verificación visual (Chrome headless + DevTools Protocol, `scripts/cdp_shot.mjs`)
Capturas en `docs/evidencia/`:
| Archivo | Contenido |
|---|---|
| `01_geografico_oscuro.png` | Vista geográfica, tema oscuro, panel de planificación |
| `02_geografico_claro.png` | Tema claro (editorial) |
| `03_esquematico_octolineal.png` | Esquemático octolinear con etiquetas alternadas |
| `04–06_laboratorio_*.png` | Inicio, paso 61/209 (relajaciones), paso 209/209 (camino reconstruido) |
| `07–09_incidencia*.png` | Desvío (Δ 56 min), desconexión («Sin ruta disponible»), marca X a 2× |
| `10_buscador_incremental.png` | Ctrl+K con lista filtrable |
| `11_vista_textual_alternativas.png` | Textual accesible + rutas alternativas de Yen |
| `12_movil_390px.png` | Layout móvil real (390×844) |

Puntos verificados en navegador: cálculo con URL, laboratorio paso a paso (con clics reales vía CDP), incidencia con marca correcta (posición comprobada numéricamente: la X cae en el punto medio del tramo Prado↔Parque Berrío), ruta escenario dibujada con casing, tema claro/oscuro, móvil y buscador.

## 4. Decisiones de diseño
- **Una fuente de verdad**: el cálculo vive del lado del backend; el frontend deriva el estado visual del laboratorio desde los eventos, sin recalcular nada de la lógica del algoritmo.
- **Esquemático = dato, no código**: tabla documentada en `schematic.ts` con retícula, ejes y excepciones.
- **Rótulos por jerarquía**: terminales y transbordos reales visibles; resto bajo hover/enfoque — reduce el ruido sin perder información.
- **Incidencias no destructivas**: par `estación↔estación` como estado de UI, `connection.id` dirigidos solo en la petición.

## 5. Limitaciones conocidas
- El esquemático es una **interpretación autoral** de la retícula: en clústeres densos (San Antonio/Cisneros/Caribe) puede haber roces leves entre etiquetas rotadas; quedan legibles y el resto de la red está limpia.
- La vista esquemática en móvil mantiene mucho scroll vertical (es inherentemente alta); se puede desplazar con gestos nativos.
- El aislamiento de `closedConnections` se probó alternando peticiones (10 pares) y con el grafo compartido intacto; no hay prueba de concurrencia multihilo real desde la UI (el backend usa grafo de trabajo por solicitud).
- El «Compartir» copia la URL al portapapeles donde el navegador lo permite (en http local algunos navegadores lo restringen).
- Aún no hay pruebas E2E automatizadas de UI: la verificación visual fue manual-asistida (CDP), reproducible con `scripts/cdp_shot.mjs`.

## 6. Cómo correr
```powershell
pwsh -NoProfile -File build.ps1 -Serve   # backend + API en :18080 (sirve frontend/dist)
cd frontend && npm run build             # o npm run dev (Vite en :5173, proxy /api)
node scripts/cdp_shot.mjs <url> <salida.png> "[acción JS]" [WxH]   # evidencia visual
```

Diseño y desarrollo — **samirjosegil**
