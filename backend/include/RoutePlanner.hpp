#pragma once

#include <string>
#include <vector>

#include "Bfs.hpp"
#include "Dijkstra.hpp"
#include "Graph.hpp"
#include "Route.hpp"
#include "Trace.hpp"

namespace mf {

struct TraceResult {
    AlgorithmStats stats;
    std::vector<TraceEvent> trace;
};

// Fachada del motor de rutas. Reúne los algoritmos y expone resultados de alto
// nivel (Route) sin obligar a la interfaz a conocer los detalles internos.
class RoutePlanner {
public:
    explicit RoutePlanner(const Graph& graph) : graph_(graph) {}

    // Ruta de menor tiempo de viaje. El costo suma el tiempo de los tramos y
    // una penalización al cambiar de línea; por eso Dijkstra se ejecuta sobre
    // el grafo de estados (estación, línea): el costo depende de cómo se llegó.
    Route fastest(int from, int to) const;

    // Ruta con el menor número de conexiones (BFS). No es necesariamente la
    // más rápida cuando los tiempos entre estaciones son distintos.
    Route fewestStops(int from, int to) const;

    // k rutas más cortas por tiempo (algoritmo de Yen). k >= 1.
    std::vector<Route> alternatives(int from, int to, int k) const;

    // Traza de Dijkstra sobre estados (estación, línea) coherente con fastest().
    TraceResult dijkstraTrace(int from, int to, bool record) const;

    // Traza de BFS para el laboratorio.
    TraceResult bfsTrace(int from, int to, bool record) const;

    const Graph& graph() const { return graph_; }

private:
    const Graph& graph_;
};

}  // namespace mf
