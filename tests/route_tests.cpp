#include "doctest.h"

#include <filesystem>

#include "DataLoader.hpp"
#include "Dijkstra.hpp"
#include "Graph.hpp"
#include "RoutePlanner.hpp"

using namespace mf;

namespace {

void addStation(Graph& graph, const std::string& name,
                std::vector<std::string> lines = {"L1"}) {
    Station s;
    s.name = name;
    s.lines = std::move(lines);
    graph.addStation(s);
}

void addEdge(Graph& graph, int from, int to, double time,
             const std::string& line = "L1", bool available = true) {
    Edge e;
    e.from = from;
    e.to = to;
    e.line = line;
    e.timeMin = time;
    e.distanceKm = time;  // irrelevante para las pruebas de costo
    e.available = available;
    graph.addEdge(e);
}

// S--A--B--C--T (4 saltos, 4 min) frente a S--T directo (1 salto, 10 min).
// Dijkstra elige el camino largo si suma menos tiempo; BFS elige el directo.
Graph makeHopVsTimeGraph() {
    Graph graph;
    for (const char* name : {"S", "A", "B", "C", "T"}) addStation(graph, name);
    const int s = 0, a = 1, b = 2, c = 3, t = 4;
    addEdge(graph, s, a, 1);
    addEdge(graph, a, b, 1);
    addEdge(graph, b, c, 1);
    addEdge(graph, c, t, 1);
    addEdge(graph, s, t, 10);
    return graph;
}

// Red con dos líneas: obliga a transbordar en M.
Graph makeTransferGraph() {
    Graph graph;
    addStation(graph, "S", {"L1"});
    addStation(graph, "M", {"L1", "L2"});
    addStation(graph, "T", {"L2"});
    addEdge(graph, 0, 1, 1.0, "L1");
    addEdge(graph, 1, 2, 1.0, "L2");
    return graph;
}

}  // namespace

TEST_CASE("Dijkstra encuentra el tiempo mínimo aunque tenga más saltos") {
    Graph graph = makeHopVsTimeGraph();
    const auto result = Dijkstra::compute(graph, 0, 4);
    CHECK(result.dist[4] == doctest::Approx(4.0));
    CHECK(result.hasPath(4));
}

TEST_CASE("BFS encuentra el menor número de conexiones") {
    Graph graph = makeHopVsTimeGraph();
    const auto result = Bfs::compute(graph, 0, 4);
    CHECK(result.hops[4] == 1);  // S -> T directo
}

TEST_CASE("RoutePlanner: tiempo y saltos difieren en el ejemplo contraste") {
    Graph graph = makeHopVsTimeGraph();
    RoutePlanner planner(graph);
    const Route time = planner.fastest(0, 4);
    const Route hops = planner.fewestStops(0, 4);

    REQUIRE(time.found);
    REQUIRE(hops.found);
    CHECK(time.totalMin == doctest::Approx(4.0));
    CHECK(time.stops == 4);
    CHECK(hops.stops == 1);
    CHECK(hops.totalMin == doctest::Approx(10.0));
}

TEST_CASE("fastest aplica la penalización de transbordo al cambiar de línea") {
    Graph graph = makeTransferGraph();
    graph.setTransferPenaltyMin(3.0);
    RoutePlanner planner(graph);
    const Route route = planner.fastest(0, 2);

    REQUIRE(route.found);
    CHECK(route.transfers == 1);
    // 1 min + 3 min de transbordo + 1 min = 5 min.
    CHECK(route.totalMin == doctest::Approx(5.0));
}

TEST_CASE("Yen devuelve las k rutas alternativas ordenadas por costo") {
    Graph graph;
    addStation(graph, "S");
    addStation(graph, "A");
    addStation(graph, "B");
    addStation(graph, "T");
    addEdge(graph, 0, 1, 1);  // S-A
    addEdge(graph, 1, 3, 1);  // A-T
    addEdge(graph, 0, 2, 5);  // S-B
    addEdge(graph, 2, 3, 5);  // B-T

    RoutePlanner planner(graph);
    const auto routes = planner.alternatives(0, 3, 2);

    REQUIRE(routes.size() == 2);
    CHECK(routes[0].totalMin == doctest::Approx(2.0));
    CHECK(routes[1].totalMin == doctest::Approx(10.0));
    CHECK(routes[0].stations != routes[1].stations);
}

TEST_CASE("Origen igual a destino produce una ruta vacía encontrada") {
    Graph graph = makeHopVsTimeGraph();
    RoutePlanner planner(graph);
    const Route route = planner.fastest(0, 0);
    CHECK(route.found);
    CHECK(route.stops == 0);
    CHECK(route.totalMin == doctest::Approx(0.0));
}

TEST_CASE("Grafo desconectado: no hay ruta") {
    Graph graph;
    addStation(graph, "S");
    addStation(graph, "T");  // sin aristas
    RoutePlanner planner(graph);
    const Route route = planner.fastest(0, 1);
    CHECK_FALSE(route.found);
    CHECK_FALSE(planner.fewestStops(0, 1).found);
}

TEST_CASE("La reconstrucción de ruta es consistente con el costo mínimo") {
    Graph graph = makeHopVsTimeGraph();
    RoutePlanner planner(graph);
    const Route route = planner.fastest(0, 4);
    double recomputed = 0.0;
    for (const RouteLeg& leg : route.legs) recomputed += leg.timeMin;
    CHECK(recomputed == doctest::Approx(route.totalMin));
    CHECK(route.stations.front() == 0);
    CHECK(route.stations.back() == 4);
}

TEST_CASE("Cargar la red real del SITVA ampliada (Metro + Tranvía + Cables + O)") {
    namespace fs = std::filesystem;
    const fs::path root = fs::path(__FILE__).parent_path().parent_path();
    const fs::path stationsPath = root / "data" / "stations.json";
    if (!fs::exists(stationsPath)) {
        return;  // se omite si no se ejecuta desde el repositorio
    }
    const Graph graph = DataLoader::loadFromJson(
        stationsPath.string(),
        (root / "data" / "connections.json").string());
    // Metro A+B (27) + Tranvía (8 nuevas) + Cables K/J/H/M (11 nuevas) +
    // Metroplús O (11 nuevas) = 57 estaciones únicas.
    CHECK(graph.stationCount() == 57);
    CHECK(graph.edgeCount() == 114);
    CHECK(graph.hasStation("San Antonio"));
    // San Antonio es transbordo Metro A + Metro B + Tranvía T.
    CHECK(graph.station(graph.idOf("San Antonio")).lines.size() == 3);
    CHECK(graph.hasStation("Villa Sierra"));    // Metrocable H
    CHECK(graph.hasStation("La Palma"));        // Metroplús O
    CHECK(graph.hasStation("Alejandro Echavarría"));  // Tranvía T
}

TEST_CASE("La red contiene un ciclo: Dijkstra y BFS difieren para al menos un par") {
    namespace fs = std::filesystem;
    const fs::path root = fs::path(__FILE__).parent_path().parent_path();
    const fs::path stationsPath = root / "data" / "stations.json";
    if (!fs::exists(stationsPath)) {
        return;
    }
    const Graph graph = DataLoader::loadFromJson(
        stationsPath.string(),
        (root / "data" / "connections.json").string());
    const RoutePlanner planner(graph);

    int differing = 0;
    const int n = graph.stationCount();
    for (int a = 0; a < n; ++a) {
        for (int b = 0; b < n; ++b) {
            if (a == b) continue;
            const Route byTime = planner.fastest(a, b);
            const Route byHops = planner.fewestStops(a, b);
            if (byTime.found && byHops.found && byTime.stations != byHops.stations) {
                ++differing;
            }
        }
    }
    // El ciclo Metroplús O (Caribe - Floresta) debe producir contrastes reales.
    CHECK(differing > 0);
}

TEST_CASE("Las conexiones no disponibles se excluyen de la exploración") {
    Graph graph;
    addStation(graph, "S");
    addStation(graph, "M");
    addStation(graph, "T");
    addEdge(graph, 0, 1, 1.0, "L1", true);   // S-M abierta
    addEdge(graph, 1, 2, 1.0, "L1", false);  // M-T cerrada

    RoutePlanner planner(graph);
    CHECK_FALSE(planner.fastest(0, 2).found);
    CHECK_FALSE(planner.fewestStops(0, 2).found);
    CHECK_FALSE(Dijkstra::compute(graph, 0, 2).hasPath(2));
    CHECK_FALSE(Bfs::compute(graph, 0, 2).hasPath(2));
}

TEST_CASE("Un tramo cerrado no se usa aunque sea el más corto") {
    Graph graph;
    addStation(graph, "S");
    addStation(graph, "A");
    addStation(graph, "T");
    addEdge(graph, 0, 1, 1.0);               // S-A
    addEdge(graph, 1, 2, 1.0);               // A-T
    addEdge(graph, 0, 2, 0.5, "L1", false);  // S-T cerrada y más barata

    RoutePlanner planner(graph);
    const Route route = planner.fastest(0, 2);
    REQUIRE(route.found);
    // Debe rodear por A (1 + 1 = 2) y nunca tomar el atajo cerrado (0.5).
    CHECK(route.totalMin == doctest::Approx(2.0));
    REQUIRE(route.stations.size() == 3);
    CHECK(route.stations[1] == 1);
}

TEST_CASE("Las rutas alternativas tampoco reintroducen conexiones cerradas") {
    Graph graph;
    addStation(graph, "S", {"L1", "L2"});
    addStation(graph, "A", {"L1"});
    addStation(graph, "B", {"L2"});
    addStation(graph, "T", {"L1", "L2"});
    addEdge(graph, 0, 1, 1.0, "L1");            // S-A
    addEdge(graph, 1, 3, 1.0, "L1");            // A-T
    addEdge(graph, 0, 2, 1.0, "L2");            // S-B
    addEdge(graph, 2, 3, 1.0, "L2");            // B-T
    addEdge(graph, 0, 3, 0.2, "L1", false);     // S-T cerrada (sería la mejor)

    RoutePlanner planner(graph);
    const auto routes = planner.alternatives(0, 3, 3);
    REQUIRE(!routes.empty());
    for (const Route& route : routes) {
        // Ninguna ruta puede saltar directamente de S (0) a T (3).
        REQUIRE(route.stations.size() >= 2);
        CHECK(route.totalMin > doctest::Approx(0.5));
        for (const RouteLeg& leg : route.legs) {
            CHECK_FALSE((leg.from == 0 && leg.to == 3));
        }
    }
}
