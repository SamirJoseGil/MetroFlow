#include "doctest.h"

#include <algorithm>
#include <string>

#include "Bfs.hpp"
#include "Dijkstra.hpp"
#include "Graph.hpp"
#include "RoutePlanner.hpp"
#include "Serialize.hpp"

using namespace mf;

namespace {

Graph makeHopVsTimeGraph() {
    Graph graph;
    auto add = [&](const char* name, std::vector<std::string> lines = {"L1"}) {
        Station s;
        s.name = name;
        s.lines = std::move(lines);
        graph.addStation(s);
    };
    add("S");
    add("A");
    add("B");
    add("C");
    add("T");
    auto edge = [&](int from, int to, double time, const char* line = "L1") {
        Edge e;
        e.from = from;
        e.to = to;
        e.line = line;
        e.timeMin = time;
        graph.addEdge(e);
    };
    edge(0, 1, 1);
    edge(1, 2, 1);
    edge(2, 3, 1);
    edge(3, 4, 1);
    edge(0, 4, 10);
    return graph;
}

bool hasType(const std::vector<TraceEvent>& trace, TraceType type) {
    return std::any_of(trace.begin(), trace.end(),
                       [&](const TraceEvent& ev) { return ev.type == type; });
}

}  // namespace

TEST_CASE("La traza de Dijkstra registra los tipos de evento y termina con path") {
    Graph graph = makeHopVsTimeGraph();
    const auto res = Dijkstra::compute(graph, 0, 4, /*recordTrace=*/true);

    REQUIRE_FALSE(res.trace.empty());
    CHECK(static_cast<int>(res.trace.front().type) == static_cast<int>(TraceType::Init));
    CHECK(hasType(res.trace, TraceType::Push));
    CHECK(hasType(res.trace, TraceType::Extract));
    CHECK(hasType(res.trace, TraceType::Relax));
    CHECK(hasType(res.trace, TraceType::UpdateDist));
    CHECK(hasType(res.trace, TraceType::UpdateParent));
    CHECK(res.stats.extractions == 5);  // S-A-B-C-T (early exit en T)
}

TEST_CASE("La traza de Dijkstra es coherente con las distancias finales") {
    Graph graph = makeHopVsTimeGraph();
    const auto res = Dijkstra::compute(graph, 0, 4, true);

    // Cada actualización debe ser una mejora estricta de su propia estación.
    for (const TraceEvent& ev : res.trace) {
        if (ev.type == TraceType::UpdateDist) {
            CHECK(ev.dist < ev.previous - 1e-9);
        }
    }
    // La última mejora del destino fija su distancia final.
    double targetDist = kInfinity;
    for (const TraceEvent& ev : res.trace) {
        if (ev.type == TraceType::UpdateDist && ev.node == 4) {
            targetDist = ev.dist;
        }
    }
    CHECK(res.dist[4] == doctest::Approx(targetDist));
    CHECK(res.dist[4] == doctest::Approx(4.0));

    // Las estadísticas reflejan los eventos emitidos.
    const auto countType = [&](TraceType type) {
        return static_cast<long long>(std::count_if(
            res.trace.begin(), res.trace.end(),
            [&](const TraceEvent& ev) { return ev.type == type; }));
    };
    CHECK(res.stats.extractions == countType(TraceType::Extract));
    CHECK(res.stats.relaxations == countType(TraceType::Relax));
    CHECK(res.stats.updates == countType(TraceType::UpdateDist));
    // stats.pushes cuenta inserciones en la cola de prioridad (origen + cada
    // mejora); solo la del origen se emite como evento Push.
    CHECK(res.stats.pushes >= countType(TraceType::Push));
    CHECK(res.stats.pushes ==
          countType(TraceType::Push) + countType(TraceType::UpdateDist));
}

TEST_CASE("La traza de BFS no emite eventos path (reconstrucción por pred)") {
    Graph graph = makeHopVsTimeGraph();
    const auto res = Bfs::compute(graph, 0, 4, true);

    REQUIRE_FALSE(res.trace.empty());
    CHECK_FALSE(hasType(res.trace, TraceType::Path));
    CHECK(res.hops[4] == 1);  // camino directo S -> T
    // Los predecesores reconstruyen el mismo camino de 1 salto.
    CHECK(res.parent[4] == 0);
}

TEST_CASE("RoutePlanner.dijkstraTrace emite path con los tramos de la ruta") {
    Graph graph = makeHopVsTimeGraph();
    RoutePlanner planner(graph);
    const auto tr = planner.dijkstraTrace(0, 4, true);

    const auto paths = std::count_if(
        tr.trace.begin(), tr.trace.end(),
        [](const TraceEvent& ev) { return ev.type == TraceType::Path; });
    CHECK(paths == 4);  // S-A-B-C-T tiene 4 tramos

    // Los tramos path reconstruyen la ruta de menor costo y su origen es S.
    bool seenSource = false;
    for (const TraceEvent& ev : tr.trace) {
        if (ev.type != TraceType::Path) continue;
        seenSource = seenSource || ev.from == 0;
        CHECK(ev.dist == doctest::Approx(4.0));  // costo total de S-A-B-C-T
    }
    CHECK(seenSource);
}

TEST_CASE("El cierre de una arista en una copia no altera el grafo original") {
    // Garantía de la concurrencia: graphForRequest copia el grafo y cierra
    // aristas solo en la copia; el grafo compartido no debe mutar nunca.
    // S-A-B-C-T suma 4 min; S-T directo suma 0.5 min (el atajo preferido).
    Graph graph;
    auto add = [&](const char* name) {
        Station s;
        s.name = name;
        s.lines = {"L1"};
        graph.addStation(s);
    };
    add("S");
    add("A");
    add("B");
    add("C");
    add("T");
    auto edge = [&](int from, int to, double time) {
        Edge e;
        e.from = from;
        e.to = to;
        e.line = "L1";
        e.timeMin = time;
        graph.addEdge(e);
    };
    edge(0, 1, 1);
    edge(1, 2, 1);
    edge(2, 3, 1);
    edge(3, 4, 1);
    const int shortcutIndex = graph.edgeCount();  // S-T directo, el más barato
    edge(0, 4, 0.5);

    const Route direct = RoutePlanner(graph).fastest(0, 4);
    CHECK(direct.totalMin == doctest::Approx(0.5));

    Graph working = graph;  // copia (setEdgeAvailable muta solo la copia)
    working.setEdgeAvailable(shortcutIndex, false);
    const Route detour = RoutePlanner(working).fastest(0, 4);

    REQUIRE(detour.found);
    CHECK(detour.totalMin == doctest::Approx(4.0));  // rodeo por A-B-C

    // El grafo original sigue teniendo la arista disponible y la ruta intacta.
    CHECK(graph.edge(shortcutIndex).available);
    CHECK(RoutePlanner(graph).fastest(0, 4).totalMin == doctest::Approx(0.5));
}

TEST_CASE("traceToJsonString expone events y stats con los nombres del protocolo") {
    Graph graph = makeHopVsTimeGraph();
    const auto tr = RoutePlanner(graph).dijkstraTrace(0, 4, true);
    const std::string json = jsonio::traceToJsonString(graph, tr.trace, tr.stats);

    CHECK(json.find("\"events\"") != std::string::npos);
    CHECK(json.find("\"stats\"") != std::string::npos);
    CHECK(json.find("\"type\": \"path\"") != std::string::npos);
    CHECK(json.find("\"type\": \"extract\"") != std::string::npos);
}
