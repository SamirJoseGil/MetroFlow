#pragma once

#include <limits>
#include <vector>

#include "Graph.hpp"
#include "Trace.hpp"

namespace mf {

constexpr double kInfinity = std::numeric_limits<double>::infinity();

// Resultado de ejecutar Dijkstra: distancias mínimas y árbol de predecesores.
struct DijkstraResult {
    std::vector<double> dist;    // vector<double>: costo mínimo conocido
    std::vector<int> parent;     // vector<int>: predecesor en el camino mínimo
    std::vector<int> parentEdge; // índice de la arista usada para llegar
    AlgorithmStats stats;
    std::vector<TraceEvent> trace;  // eventos (vacío si no se solicitaron)

    bool hasPath(int target) const {
        return dist[static_cast<size_t>(target)] < kInfinity;
    }
};

// Dijkstra sobre un grafo con pesos no negativos (aquí, minutos de viaje).
// Implementación con std::priority_queue y "lazy deletion": al extraer una
// estación cuya distancia ya no coincide con la mejor conocida, se descarta.
// Complejidad: O((V + E) log V).
class Dijkstra {
public:
    // Si target >= 0, se detiene al asentar esa estación (early exit).
    // recordTrace guarda eventos para el laboratorio visual.
    static DijkstraResult compute(const Graph& graph, int source,
                                  int target = -1, bool recordTrace = false);

    // Variante con aristas/nodos prohibidos, usada por Yen para calcular
    // rutas alternativas. allowedEdges (opcional) restringe el conjunto de
    // aristas permitidas (por ejemplo, las aristas de la ruta raíz).
    static DijkstraResult computeFiltered(
        const Graph& graph, int source, int target,
        const std::vector<bool>& bannedEdges,
        const std::vector<bool>& bannedNodes,
        const std::vector<bool>* allowedEdges = nullptr);
};

}  // namespace mf
