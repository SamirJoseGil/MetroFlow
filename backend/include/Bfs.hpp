#pragma once

#include <vector>

#include "Graph.hpp"
#include "Trace.hpp"

namespace mf {

// Resultado de BFS: número mínimo de conexiones (saltos) desde el origen.
struct BfsResult {
    std::vector<int> hops;       // -1 si no es alcanzable
    std::vector<int> parent;     // predecesor en el árbol BFS
    std::vector<int> parentEdge; // arista usada para llegar
    AlgorithmStats stats;
    std::vector<TraceEvent> trace;

    bool hasPath(int target) const {
        return hops[static_cast<size_t>(target)] >= 0;
    }
};

// BFS sobre el grafo no ponderado (cada arista cuenta como un paso).
// Encuentra el camino con MENOS CONEXIONES, no el más rápido: eso solo es
// equivalente a "más rápido" cuando todas las aristas tienen igual costo.
// Implementación con std::queue<int>. Complejidad: O(V + E).
class Bfs {
public:
    static BfsResult compute(const Graph& graph, int source, int target = -1,
                             bool recordTrace = false);
};

}  // namespace mf
