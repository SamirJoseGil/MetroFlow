#include "Bfs.hpp"

#include <chrono>
#include <queue>
#include <stdexcept>

namespace mf {

BfsResult Bfs::compute(const Graph& graph, int source, int target,
                       bool recordTrace) {
    const int n = graph.stationCount();
    if (source < 0 || source >= n) {
        throw std::out_of_range("Bfs: estación origen fuera de rango");
    }

    BfsResult result;
    result.hops.assign(n, -1);
    result.parent.assign(n, -1);
    result.parentEdge.assign(n, -1);

    const auto start = std::chrono::steady_clock::now();

    auto trace = [&](TraceType type, int node, int from, double dist,
                     std::string line, std::string note) {
        if (!recordTrace) return;
        result.trace.push_back(TraceEvent{type, node, from, dist, 0.0,
                                          std::move(line), std::move(note),
                                          {}, -1, {}});
    };

    std::queue<int> queue;  // BFS: FIFO garantiza exploración por niveles

    result.hops[source] = 0;
    queue.push(source);
    ++result.stats.pushes;
    trace(TraceType::Push, source, -1, 0.0, "",
          "origen en la cola con 0 conexiones");

    while (!queue.empty()) {
        const int u = queue.front();
        queue.pop();
        ++result.stats.extractions;
        ++result.stats.settledNodes;
        trace(TraceType::Extract, u, -1, result.hops[u], "",
              "estación extraída de la cola (orden por niveles)");

        if (u == target) break;

        for (const int edgeIndex : graph.outEdges(u)) {
            const Edge& e = graph.edge(edgeIndex);
            // Los tramos cerrados no se exploran: equivalen a no existir.
            if (!e.available) continue;
            ++result.stats.relaxations;
            trace(TraceType::Relax, e.to, u, result.hops[u] + 1.0, e.line,
                  "conexión examinada");
            if (result.hops[e.to] == -1) {
                result.hops[e.to] = result.hops[u] + 1;
                result.parent[e.to] = u;
                result.parentEdge[e.to] = edgeIndex;
                ++result.stats.updates;
                queue.push(e.to);
                ++result.stats.pushes;
                trace(TraceType::UpdateDist, e.to, u, result.hops[e.to], e.line,
                      "se descubre con un salto más");
                trace(TraceType::UpdateParent, e.to, u, result.hops[e.to],
                      e.line, "predecesor registrado");
            }
        }
    }

    const auto end = std::chrono::steady_clock::now();
    result.stats.elapsedMs =
        std::chrono::duration<double, std::milli>(end - start).count();
    return result;
}

}  // namespace mf
