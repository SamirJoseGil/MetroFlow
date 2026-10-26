/**
 * Prueba de concurrencia real de la API HTTP.
 *
 * Lanza muchas solicitudes simultáneas que alternan entre la red completa y un
 * escenario con tramos cerrados, y verifica que el resultado de cada una sea
 * determinista. Esto es lo que garantiza que `graphForRequest` no contamina el
 * grafo compartido entre peticiones concurrentes (aislamiento por solicitud).
 *
 * Uso: node scripts/test_concurrency.mjs [urlBase] [rondas]
 * Requiere que la API esté corriendo (./build.ps1 -Serve).
 */

const base = process.argv[2] ?? "http://localhost:18080";
const rounds = Number(process.argv[3] ?? 25);

// Bello (1) -> Aguacatala (15): red completa = 25.5 min; con el tramo
// Universidad<->Hospital cerrado = desvío de 56 min.
const NORMAL = { from: 1, to: 15, criterion: "time" };
const SCENARIO = { from: 1, to: 15, criterion: "time", closedConnections: [12, 13] };
const EXPECT_NORMAL_MIN = 25.5;
const EXPECT_SCENARIO_MIN = 56;

const post = (path, body) =>
  fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then((r) => {
    if (!r.ok) throw new Error(`${path} -> ${r.status}`);
    return r.json();
  });

async function oneRound(i) {
  // En cada ronda se interlevan normal y escenario en paralelo, de modo que
  // ambos usan el grafo compartido al mismo tiempo.
  const [normal, scenario] = await Promise.all([
    post("/api/route", NORMAL),
    post("/api/route", SCENARIO),
    post("/api/trace", NORMAL), // la traza también lee el grafo compartido
  ]);
  return { i, normal: normal.totalMin, scenario: scenario.totalMin };
}

const results = await Promise.all(
  Array.from({ length: rounds }, (_, i) => oneRound(i)),
);

let failures = 0;
for (const r of results) {
  const okNormal = Math.abs(r.normal - EXPECT_NORMAL_MIN) < 0.05;
  const okScenario = Math.abs(r.scenario - EXPECT_SCENARIO_MIN) < 0.05;
  if (!okNormal || !okScenario) {
    failures++;
    console.error(
      `ronda ${r.i}: normal=${r.normal} (esperado ${EXPECT_NORMAL_MIN}), ` +
        `escenario=${r.scenario} (esperado ${EXPECT_SCENARIO_MIN})`,
    );
  }
}

console.log(
  `concurrencia: ${rounds} rondas x 3 peticiones simultáneas = ` +
    `${rounds * 3} solicitudes; fallos: ${failures}`,
);
if (failures > 0) process.exitCode = 1;
