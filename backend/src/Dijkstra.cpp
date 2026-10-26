#include "Dijkstra.hpp"

#include <chrono>
#include <functional>
#include <queue>
#include <stdexcept>
#include <utility>

namespace mf {

namespace {

using QueueItem = std::pair<double, int>;  // (costo provisional, estación)

DijkstraResult run(const Graph& graph, int source, int target, bool recordTrace,
                   const std::function<bool(int)>& edgeAllowed,
                   const std::function<bool(int)>& nodeAllowed) {
    const int n = graph.stationCount();
    if (source < 0 || source >= n) {
        throw std::out_of_range("Dijkstra: estación origen fuera de rango");
    }

    DijkstraResult result;
    result.dist.assign(n, kInfinity);
    result.parent.assign(n, -1);
    result.parentEdge.assign(n, -1);

    const auto start = std::chrono::steady_clock::now();

    auto trace = [&](TraceType type, int node, int from, double dist,
                     double previous, std::string line, std::string note) {
        if (!recordTrace) return;
        result.trace.push_back(TraceEvent{type, node, from, dist, previous,
                                          std::move(line), std::move(note),
                                          {}, -1, {}});
    };

    // Cola de prioridad min-heap: extrae la estación de menor costo.
    std::priority_queue<QueueItem, std::vector<QueueItem>,
                        std::greater<QueueItem>>
        pq;

    result.dist[source] = 0.0;
    pq.push({0.0, source});
    ++result.stats.pushes;
    trace(TraceType::Init, source, -1, 0.0, kInfinity, "",
          "origen inicializado en 0; el resto en infinito");
    trace(TraceType::Push, source, -1, 0.0, kInfinity, "", "origen en la cola");

    while (!pq.empty()) {
        const auto [d, u] = pq.top();
        pq.pop();
        ++result.stats.extractions;

        if (d > result.dist[u]) {
            ++result.stats.staleEntries;
            trace(TraceType::Skip, u, -1, d, result.dist[u], "",
                  "entrada obsoleta descartada (lazy deletion)");
            continue;
        }

        ++result.stats.settledNodes;
        trace(TraceType::Extract, u, -1, d, d, "",
              "extraída con la menor distancia provisional");

        if (u == target) break;

        for (const int edgeIndex : graph.outEdges(u)) {
            if (!edgeAllowed(edgeIndex)) continue;
            const Edge& e = graph.edge(edgeIndex);
            // Las conexiones marcadas como no disponibles (cierre de tramo) no
            // participan en la relajación: se comportan como inexistentes.
            if (!e.available) continue;
            if (!nodeAllowed(e.to)) continue;

            ++result.stats.relaxations;
            const double candidate = d + e.timeMin;
            trace(TraceType::Relax, e.to, u, candidate, result.dist[e.to], e.line,
                  "conexión examinada");

            if (candidate < result.dist[e.to] - 1e-9) {
                const double previous = result.dist[e.to];
                result.dist[e.to] = candidate;
                result.parent[e.to] = u;
                result.parentEdge[e.to] = edgeIndex;
                ++result.stats.updates;
                pq.push({candidate, e.to});
                ++result.stats.pushes;
                trace(TraceType::UpdateDist, e.to, u, candidate, previous, e.line,
                      "distancia mejorada");
                trace(TraceType::UpdateParent, e.to, u, candidate, previous,
                      e.line, "predecesor actualizado");
            }
        }
    }

    const auto end = std::chrono::steady_clock::now();
    result.stats.elapsedMs =
        std::chrono::duration<double, std::milli>(end - start).count();
    return result;
}

}  // namespace

DijkstraResult Dijkstra::compute(const Graph& graph, int source, int target,
                                 bool recordTrace) {
    return run(graph, source, target, recordTrace,
               [](int) { return true; }, [](int) { return true; });
}

DijkstraResult Dijkstra::computeFiltered(const Graph& graph, int source,
                                         int target,
                                         const std::vector<bool>& bannedEdges,
                                         const std::vector<bool>& bannedNodes,
                                         const std::vector<bool>* allowedEdges) {
    auto edgeAllowed = [&](int edgeIndex) {
        if (edgeIndex >= 0 &&
            edgeIndex < static_cast<int>(bannedEdges.size()) &&
            bannedEdges[static_cast<size_t>(edgeIndex)]) {
            return false;
        }
        if (allowedEdges != nullptr && edgeIndex >= 0 &&
            edgeIndex < static_cast<int>(allowedEdges->size()) &&
            !(*allowedEdges)[static_cast<size_t>(edgeIndex)]) {
            return false;
        }
        return true;
    };
    auto nodeAllowed = [&](int node) {
        return !(node >= 0 && node < static_cast<int>(bannedNodes.size()) &&
                 bannedNodes[static_cast<size_t>(node)]);
    };
    return run(graph, source, target, false, edgeAllowed, nodeAllowed);
}

}  // namespace mf
