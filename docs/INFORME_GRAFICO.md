# Informe gráfico — MetroFlow

> Descripción del sistema visual **tal como está implementado** en
> `frontend/src/styles/main.css`, `frontend/src/map.ts`, `frontend/src/app.ts`,
> `frontend/src/theme.ts` e `index.html`.
>
> Las observaciones son derivadas del código y no de una inspección en navegador:
> en este entorno no se dispone de una herramienta de render visual.

---

## 1. Resumen ejecutivo

MetroFlow usa una **identidad editorial monocromática de alto contraste**:
tipografía serif para la voz principal, etiquetas sans en mayúsculas con
*tracking*, bordes rectos (`2px`), líneas de separación y ausencia de sombras y
gradientes.

La interfaz es monocromática, **con una excepción deliberada**: las líneas de
transporte conservan sus **colores semánticos**, porque codifican información
funcional del mapa. Además del color, cada tipo de servicio se distingue por el
**trazo** (sólido, discontinuo, punteado).

El sistema incluye:

- **tema claro y oscuro** persistente, con tokens invertidos;
- **tipografía editorial** (Georgia) combinada con sans de sistema y mono;
- **animaciones discretas** (entrada, expansión de líneas, revelado de ruta) y
  respeto a `prefers-reduced-motion`;
- **diseño responsivo** en tres breakpoints;
- **accesibilidad básica** (foco visible, navegación por teclado, ARIA, skip
  link).

---

## 2. Principios de identidad

1. **Editorial, no “tech”.** Se evitan neones, glassmorphism, gradientes y
   tarjetas redondeadas.
2. **Monocromo estructural.** Blanco, negro y grises para toda la interfaz.
3. **Geometría rígida.** Bordes de `2px`, radios de `2px`, líneas como recurso
   compositivo.
4. **Contraste como jerarquía.** El peso visual se logra con tamaño, masa
   tipográfica y bordes, no con color.
5. **Color solo donde informa.** Los colores de línea son datos, no decoración.
6. **Firma personal.** Pie con “Diseño y desarrollo — *samirjosegil*”.

---

## 3. Tokens del sistema

Definidos en `:root` y en `:root[data-theme="light|dark"]`.

### 3.1 Medidas y movimiento

| Token | Valor | Uso |
|---|---|---|
| `--radius` | `2px` | Todos los contornos. |
| `--maxw` | `1200px` | Ancho máximo de contenedores. |
| `--t-fast` | `120ms` | Hover y foco. |
| `--t` | `200ms` | Cambio de tema. |
| `--t-slow` | `460ms` | Entradas. |
| `--ease` | `cubic-bezier(0.2, 0.7, 0.2, 1)` | Curva estándar. |

### 3.2 Color — tema claro

| Token | Valor | Rol |
|---|---|---|
| `--bg` | `#ffffff` | Fondo. |
| `--bg-soft` | `#f6f6f5` | Fondo del mapa. |
| `--surface` | `#ffffff` | Paneles y controles. |
| `--surface-2` | `#f4f4f5` | Bloques secundarios. |
| `--ink` | `#0a0a0a` | Texto principal. |
| `--ink-2` | `#52525b` | Texto secundario. |
| `--ink-3` | `#71717a` | Metadatos. |
| `--line` | `#d4d4d8` | Separadores finos. |
| `--line-2` | `#a1a1aa` | Bordes de control. |
| `--line-strong` | `#111111` | Bordes principales. |
| `--accent` | `#0a0a0a` | Botón primario. |
| `--accent-ink` | `#ffffff` | Texto sobre acento. |
| `--focus` | `#0a0a0a` | Anillo de foco. |
| `--map-casing` | `#ffffff` | Halo de la ruta. |
| `--danger` | `#b91c1c` | Error. |

### 3.3 Color — tema oscuro

| Token | Valor | Rol |
|---|---|---|
| `--bg` | `#0a0a0a` | Fondo. |
| `--bg-soft` | `#0f0f10` | Fondo del mapa. |
| `--surface` | `#0d0d0e` | Paneles y controles. |
| `--surface-2` | `#151517` | Bloques secundarios. |
| `--ink` | `#fafafa` | Texto principal. |
| `--ink-2` | `#a1a1aa` | Texto secundario. |
| `--ink-3` | `#71717a` | Metadatos. |
| `--line` | `#2f2f33` | Separadores finos. |
| `--line-2` | `#52525b` | Bordes de control. |
| `--line-strong` | `#fafafa` | Bordes principales. |
| `--accent` | `#fafafa` | Botón primario. |
| `--accent-ink` | `#0a0a0a` | Texto sobre acento. |
| `--focus` | `#fafafa` | Anillo de foco. |
| `--map-casing` | `#0a0a0a` | Halo de la ruta. |
| `--danger` | `#f87171` | Error. |

El cambio de tema **no altera estructura ni componentes**: solo invierte la
jerarquía cromática.

### 3.4 Color semántico de líneas (fijo en ambos temas)

| Línea | Servicio | Color | Trazo |
|---|---|---|---|
| A | Metro A | `#2f6fed` | Sólido, 5px |
| B | Metro B | `#f08a1e` | Sólido, 5px |
| T | Tranvía | `#16a34a` | Discontinuo `14 5`, 4.5px |
| K | Metrocable K | `#ef4444` | Discontinuo `6 4`, 3.6px |
| J | Metrocable J | `#8b5cf6` | Discontinuo `6 4`, 3.6px |
| H | Metrocable H | `#ec4899` | Discontinuo `6 4`, 3.6px |
| M | Metrocable M | `#0ea5e9` | Discontinuo `6 4`, 3.6px |
| O | Metroplús O | `#14b8a6` | Punteado `1.5 5`, 4.4px |

Color de respaldo si una línea no está mapeada: `#8b5cf6`.

---

## 4. Tipografía

| Rol | Familia | Notas |
|---|---|---|
| Títulos y marca | `Georgia, "Times New Roman", "Liberation Serif", serif` | Voz editorial. |
| Interfaz y etiquetas | `system-ui, -apple-system, "Segoe UI", Roboto, …` | Sin webfonts. |
| Datos técnicos / laboratorio | `ui-monospace, "Cascadia Code", "SFMono-Regular", Menlo, …` | Trazas y eventos. |

Escala y tratamientos:

| Elemento | Tamaño | Tratamiento |
|---|---|---|
| `brand-name` | 22px | Serif, peso 700. |
| `display` | `clamp(26px, 3.2vw, 40px)` | Serif. |
| `panel h2` | 22px | Serif. |
| `panel h3` | 19px | Serif. |
| `eyebrow` | 11px | Sans, mayúsculas, `letter-spacing 0.18em`, gris. |
| Etiquetas de campo / `dt` | 10–11px | Mayúsculas, `tracking 0.14em`. |
| `metric-value` | 26px | Serif, `tabular-nums`. |
| `leg-path` | 15px | Serif. |
| `station-label` | 11px | Sans, peso 500. |
| Eventos de laboratorio | 12px | Mono. |
| Cuerpo | 15px / 1.5 | Sans. |

Contraste de roles: **serif** para lo narrativo/numérico, **sans versalita** para
metadatos y **mono** para lo técnico.

---

## 5. Layout y composición

### 5.1 Estructura

```
header sticky (borde inferior 2px)
  monograma MF + marca + subtítulo · datos de red · toggle de tema
main.layout  (grid 1fr / 360px, gap 32)
  section.stage
    section-head (eyebrow + display + rule)
    map-shell (grid 1fr / 190px)
      map-wrap (mapa + controles de zoom)
      map-aside (leyenda + ayuda)
  aside.side  (sticky top 88px)
    panel.planner
    #results
footer (borde superior 2px · aviso + firma)
```

- Contenedor máximo: **1200px**.
- `layout`: `padding: 32px 24px 56px`.
- `side` es **sticky** en escritorio.
- `panel`: borde `2px`, padding `20px`, radio `2px`.
- `map-wrap`: borde `2px`, padding `10px`, fondo `--bg-soft`.
- `footer`: padding `24px`.

### 5.2 Encabezado de sección

Patrón repetido:

1. `eyebrow` (“01 — Red”, “02 — Viaje”, “03 — Opciones”).
2. Título serif (`display`).
3. Regla horizontal de `2px` con ancho parcial (`--rule-w`, por ejemplo 32%),
   que **crece desde 0** al entrar.

### 5.3 Ritmo

El espaciado es moderado y funcional, más cercano a una herramienta que a una
publicación: no se usan los `py-20` de la guía de estilo, sino paddings de
`20–32px`. La jerarquía se sostiene por bordes y tipografía más que por aire.

---

## 6. Componentes

### 6.1 Cabecera

- Fondo `--bg`, borde inferior `2px`, `position: sticky`.
- **Monograma** “MF” en caja de `38×38` con borde `2px` y serif.
- Título “MetroFlow” + subtítulo en versalitas (“PLANIFICADOR DE RUTAS · VALLE
  DE ABURRÁ”).
- **Datos de red** (`dl`): Estaciones, Conexiones, Líneas; valor en serif 20px,
  etiqueta en versalitas.
- **Toggle de tema**: botón-icono de `40×40`; muestra sol/luna.

### 6.2 Mapa (`MapView`)

SVG con `viewBox` `680×780` y proyección **equirectangular** de las coordenadas
reales (no esquemática). Cuatro capas, en orden de dibujo:

1. `edges` — red base.
2. `route` — ruta activa.
3. `explore` — arista explorada del laboratorio.
4. `nodes` — estaciones y etiquetas.

**Red base**

- Una línea por conexión disponible.
- Color semántico por línea.
- Grosor y patrón según el tipo de servicio (ver tabla 3.4).
- `stroke-linecap: round`, opacidad global `0.92`.

**Estaciones**

| Tipo | Radio | Anillo | Punto interior | Etiqueta |
|---|---|---|---|---|
| Normal | 3.4 | 1.7 (`color de línea`) | Oculto | Oculta; visible en hover/foco |
| Terminal | 4.4 | 3.0 | Oculto | Visible |
| Integración | 5.0 | 2.4 | Visible | Visible |
| Origen | — | Reemplaza: relleno `--ink`, borde `--bg` 3px | Oculto | — |
| Destino | — | Reemplazo: relleno `--surface`, borde `--ink` 2.6px | Visible | — |
| Explorada | — | Borde `--focus` 3.6px | — | — |

- Etiquetas: sans 11px, centradas arriba, con **halo** del color del fondo
  (`paint-order: stroke`, 3px) para legibilidad sobre las líneas.
- Las etiquetas “menores” aparecen solo al pasar el ratón o enfocar.
- Hover/foco: el anillo pasa a `--focus` con grosor `3.4`.
- Cada estación es `role="button"`, `tabindex="0"`, con `aria-label` y
  activación por Enter/Espacio.
- `title` nativo con nombre y líneas.

**Ruta activa**

- **Casco** (casing) de 11px en `--map-casing` (blanco/negro según tema) para
  separar la ruta de la red.
- **Tramo** de 7px con el color de la línea.
- **Puntos** de estación de 2.6px en `--accent-ink` (efecto de “recorte” sobre
  la línea).
- **Revelado progresivo**: cada tramo se dibuja con `stroke-dashoffset`
  animado (320ms, 90ms de desfase); los puntos aparecen en cascada (220ms).
- Con `prefers-reduced-motion`, se dibuja completo sin animación.

**Laboratorio**

- Arista explorada: 5px, `stroke-dasharray: 3 5`, color de la línea, opacidad
  `0.95`. Es **estática** (no anima).
- Nodo asentado: anillo `--focus` de 3.6px.

**Interacción**

- Zoom con rueda (factor 1.12) y botones (+/−/reset) con límite `0.3×–1×`.
- Desplazamiento por arrastre con `pointer events` y `setPointerCapture`.
- El mapa usa `touch-action: none` y cursor `grab`/`grabbing`.
- Un arrastre superior a 4px marca `moved` y evita disparar el clic de estación.

### 6.3 Leyenda

- Lista con borde `2px`.
- Cada ítem: muestra de trazo de 30px + “Línea X” (sans 12, mayúsculas) +
  nombre del servicio (11px, gris).
- La muestra reproduce el **estilo de trazo** (sólido/discontinuo/punteado),
  aunque con un patrón de CSS genérico, no con los valores exactos del mapa.

### 6.4 Planificador

- Selectores nativos estilizados: borde `1.5px`, radio `2px`, padding izquierdo
  de 30px para el **punto de origen/destino** (relleno vs. anillo).
- Botón **Invertir** centrado entre campos.
- **Criterio** como control segmentado de dos opciones: contenedor con borde
  `1.5px`, opción activa invertida (fondo `--accent`).
- **Acciones** en grid: Calcular ocupa toda la fila (primario); Comparar y Paso
  a paso comparten fila.
- Nota de ayuda en 12px.

### 6.5 Botones

- Rectangulares, borde `2px`, radio `2px`, texto sans 12 en mayúsculas con
  `tracking 0.1em`, padding `11×14`.
- **Hover**: invierte a fondo `--ink` y texto `--bg`.
- **Primario**: fondo `--accent`; en hover vuelve a superficie con borde fuerte.
- **Ghost**: borde `--line-2`.
- **Deshabilitado**: opacidad `0.4`, sin interacción.
- **Icon button**: `40×40` (o `32×32` en variante small).

### 6.6 Resultados

- **Métricas**: bloque de 4 columnas separadas por líneas verticales de `1px`;
  valor serif 26px, unidad 11px, etiqueta versalita 10px.
- **Tramos**: lista con badge de `34×34` cuyo borde izquierdo de `8px` toma el
  color de la línea; ruta en serif 15px; metadatos en 11px; separador
  discontinuo entre tramos.
- **Acciones**: botón de exportación + estado en texto.
- **Entrada**: cada tramo aparece con `legIn` (desplazamiento de −8px y opacidad),
  escalonado cada 55ms.

### 6.7 Alternativas

- Tarjetas con borde `1.5px`, radio `2px`, borde izquierdo de `6px`.
- Tarjeta activa: borde fuerte, borde izquierdo `--ink`, fondo `--surface-2`.
- Contenido: “Ruta 01”, métricas (tiempo, paradas, transbordos, km) y
  **badges de línea** con el color semántico.
- Aviso explícito de que son una aproximación.

### 6.8 Comparación

- Grid de dos columnas con los paneles de Dijkstra y BFS; pasa a una columna en
  móvil.
- Comparte el mismo lenguaje de métricas y tramos.

### 6.9 Laboratorio

- Bloque de métricas (hasta 7 valores) en grid de 4 columnas.
- Controles: Reproducir/Pausar (primario), Anterior/Siguiente (icono),
  deslizador y Reiniciar (ghost).
- Línea de estado actual en **mono** con borde izquierdo de `3px`.
- Lista de eventos mono 12px, altura máxima 320px con scroll; el evento activo
  se resalta con fondo `--surface-2`.
- Se auto-desplaza al evento activo.

### 6.10 Estados

- **Boot**: centrado, marca serif 28px y nota 13px.
- **Error**: la primera nota usa `--danger`.
- **Carga**: panel con spinner de 16px (borde `2px`, giro 0.7s).
- **Aviso**: panel con icono y texto.

### 6.11 Pie

- Borde superior `2px`.
- Texto de aviso (máx. 60ch) + firma.
- Firma en serif **cursiva** con subrayado fino.

---

## 7. Tema claro/oscuro

Mecanismo:

1. `index.html` ejecuta un script **antes del primer pintado**:
   - lee `localStorage["metroflow-theme"]`;
   - si no existe, usa `prefers-color-scheme`;
   - escribe `data-theme` en `<html>` y `color-scheme`.
2. `theme.ts` expone `resolveInitialTheme`, `applyTheme`, `storeTheme`,
   `currentTheme` y `toggleTheme`.
3. El CSS define los tokens bajo `:root[data-theme="light"]` y
   `:root[data-theme="dark"]`.
4. El botón alterna y persiste; `aria-pressed` refleja el estado oscuro.
5. `color-scheme` ajusta controles nativos (selects, scrollbars).

Esto evita el **flash** de tema incorrecto al cargar.

---

## 8. Movimiento

| Efecto | Implementación | Duración |
|---|---|---|
| Entrada de cabecera | `rise` (opacidad + 14px) | 460ms |
| Entrada de escenario | `rise` con 60ms de retraso | 460ms |
| Entrada de panel lateral | `rise` con 130ms | 460ms |
| Entrada de pie | `rise` con 200ms | 460ms |
| Crecimiento de regla | `ruleGrow` (ancho 0 → final) | 640ms, +220ms |
| Entrada de tramos | `legIn` escalonado | 460ms, +55ms por tramo |
| Revelado de ruta | WAAPI `strokeDashoffset` | 320ms por tramo, +90ms |
| Puntos de ruta | WAAPI opacidad | 220ms, +90ms |
| Spinner | `spin` lineal | 0.7s |
| Hover de botones | inversión de color | 120ms |

Se respeta `prefers-reduced-motion`: se anulan animaciones y transiciones y el
mapa dibuja la ruta completa de inmediato. La ruta además comprueba la
preferencia en JS antes de animar.

---

## 9. Responsive

| Breakpoint | Cambios principales |
|---|---|
| `≤ 1040px` | Layout a una columna; `side` deja de ser sticky; `map-shell` a una columna; leyenda y ayuda en fila. |
| `≤ 720px` | Cabecera en varias filas (datos de red abajo, alineados a la izquierda); comparación a una columna; métricas a 2 columnas; `map-aside` en columna; pie en columna. |
| `≤ 420px` | Acciones del planificador a una columna (Calcular deja de ocupar toda la fila). |

El mapa se escala con `width: 100%`, `height: auto` y `max-height: 74vh`,
manteniendo la proporción del `viewBox`.

---

## 10. Accesibilidad visual

- `:focus-visible` con contorno de `2px` y `offset 2px`.
- **Skip link** (“Saltar al planificador”) visible al enfocar.
- `.sr-only` para texto solo para lectores de pantalla.
- Estaciones con `role="button"`, `tabindex`, `aria-label`, Enter/Espacio.
- Controles de zoom con `aria-label`; grupo con `role="group"`.
- Resultados con `aria-live="polite"` y `aria-busy`.
- Estado de exportación con `role="status"`.
- SVG con `role="img"` y `aria-label`.
- `prefers-reduced-motion` respetado.
- Contraste: texto principal y bordes fuertes cumplen ampliamente; los
  metadatos en `--ink-3` (`#71717a`) a 10–11px quedan en el límite y conviene
  verificarlos.

---

## 11. Iconografía

- SVG en línea propios (sin librerías): `icons.ts`.
- `viewBox 0 0 24 24`, `fill:none`, `stroke:currentColor`, grosor `1.6`,
  `linecap/linejoin: round`.
- Heredan el color del texto, por lo que funcionan en ambos temas.
- Tamaño por defecto 18px; se usan 15–20px.
- Iconos disponibles: sol, luna, invertir, descargar, más, menos, reset, play,
  pause, anterior, siguiente, ruta, comparar, buscar, reloj, flecha, capas,
  alerta, check y destello.

---

## 12. Fortalezas del sistema actual

1. **Coherencia**: un único lenguaje de bordes, radios y tipografía en toda la
   app.
2. **Tokens claros** y tema oscuro real, no una simple inversión de filtros.
3. **Excepción de color bien justificada**: las líneas siguen siendo legibles e
   identificables.
4. **Doble codificación** (color + trazo) en la red, útil para daltonismo.
5. **Jerarquía tipográfica** con serif editorial y versalitas técnicas.
6. **Movimiento contenido** y con alternativa sin animación.
7. **Base de accesibilidad** por encima de lo habitual en proyectos similares.
8. **Sin dependencias visuales**: iconos y mapa son SVG propios.

---

## 13. Observaciones y oportunidades de mejora

Ordenadas por impacto percibido para una mejora gráfica. “Impacto” se refiere a
la percepción visual; “esfuerzo” a la complejidad de implementación.

### Alto impacto / bajo–medio esfuerzo

| # | Observación | Oportunidad |
|---|---|---|
| 1 | **Densidad del mapa**: 49 estaciones en Medellín sobre una proyección geográfica real; etiquetas solo para integraciones/terminales y congestión en el centro. | Evaluar un **esquema tipo diagrama de metro** (octilínea) o un modo “esquemático/geográfico”; añadir etiquetas con detección de colisiones o líneas guía. |
| 2 | **Ritmo editorial contenido**: paddings de 20–32px y títulos de 26–40px acercan la página a un dashboard más que a la guía (`py-20`, títulos mayores). | Aumentar el aire vertical y la escala del `display`; separar más las secciones. |
| 3 | **Falta el subtítulo serif en cursiva** que define la guía editorial. | Añadir un subtítulo `italic` bajo los encabezados de sección. |
| 4 | **Toggle de tema ambiguo**: muestra el icono de la acción (sol cuando está oscuro) en lugar del estado. | Etiqueta explícita “Claro/Oscuro” o icono de estado + `aria-pressed`. |
| 5 | **Scroll táctil atrapado sobre el mapa** (`touch-action: none`). | Permitir scroll vertical de la página o añadir un control/gesto explícito de paneo. |
| 6 | **Sin favicon ni metadatos sociales**; `theme-color` ausente. | Añadir favicon monocromo, `og:` y `theme-color` por tema. |

### Impacto medio

| # | Observación | Oportunidad |
|---|---|---|
| 7 | La clase `.station.terminal` existe en el SVG pero **no tiene regla CSS**; el estilo de terminal vive en atributos inline. | Formalizar los marcadores (normal/terminal/integración) en CSS para facilitar ajustes. |
| 8 | La **leyenda** usa trazos CSS genéricos, no los patrones exactos del mapa. | Reproducir `14 5`, `6 4`, `1.5 5` con SVG o `repeating-linear-gradient`. |
| 9 | La **arista explorada** del laboratorio es estática. | Añadir un pulso o animación de guion (respetando reduced motion). |
| 10 | El **casco de la ruta** aparece completo mientras los tramos se revelan. | Animar también el casco o hacer un fundido conjunto. |
| 11 | El **foco de teclado** en estaciones se apoya solo en el cambio de anillo. | Añadir un halo de foco explícito (doble anillo) para mayor claridad. |
| 12 | **Contraste de metadatos** (`--ink-3`) al límite en tamaños de 10–11px. | Oscurecer el gris en tema claro o subir el tamaño mínimo. |
| 13 | **Bloques de métricas impares** (7 en laboratorio) dejan una celda coja en móvil. | Ajustar `grid-column` del último ítem o agrupar métricas. |
| 14 | **Comparación** son dos paneles completos, muy altos y repetitivos. | Añadir un resumen de diferencias (Δ tiempo, Δ paradas) sobre las dos columnas. |
| 15 | **Estados vacío/error** son funcionales pero poco editoriales. | Tratarlos como portada: marca grande, regla y mensaje breve. |

### Pulido

| # | Observación | Oportunidad |
|---|---|---|
| 16 | Badges de línea usan `color: var(--bg)` sobre rellenos claros (naranja, verde, cian). | Elegir texto claro/oscuro según la luminancia del color. |
| 17 | Los **puntos de ruta** son “recortes” del color de fondo; sobre líneas claras pueden perder definición. | Añadir un borde de contraste o un tamaño mínimo. |
| 18 | No hay **estilos de impresión**. | Añadir `@media print` para exportar la ruta en papel. |
| 19 | Hover de botones invierte por completo; el foco sobre ese estado puede perder contraste. | Verificar el anillo de foco sobre fondos invertidos. |
| 20 | La entrada del mapa no tiene animación propia (solo el contenedor). | Un fundido muy sutil de la red, sin exceso. |

---

## 14. Conclusión

MetroFlow tiene una base visual **coherente y con identidad**: monocromo
editorial, geometría rígida, serif como voz principal, color reservado para la
información y movimiento discreto. El sistema de tokens y el tema oscuro están
bien resueltos, y la doble codificación de las líneas (color + trazo) es un
acierto funcional.

Para una **mejora gráfica**, los mayores retornos están en:

1. **respirar más** (escala y ritmo editorial),
2. **resolver la densidad del mapa** (esquema y etiquetas),
3. **afinar detalles de interacción y accesibilidad** (tema, foco, táctil),
4. **pulir la fidelidad de la leyenda y los marcadores**.

Todo lo anterior se puede abordar sin romper la identidad ni las decisiones
funcionales ya tomadas.
