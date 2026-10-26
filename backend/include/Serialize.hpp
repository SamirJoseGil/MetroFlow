#pragma once

#include <string>
#include <vector>

#include "Bfs.hpp"
#include "Dijkstra.hpp"
#include "Graph.hpp"
#include "Route.hpp"
#include "Trace.hpp"

// Serialización a JSON con nlohmann/json. Se usa desde el CLI y desde la API,
// de modo que ambos exponen exactamente la misma representación.
namespace mf::jsonio {

std::string stationToJsonString(const Station& station);
std::string graphToJsonString(const Graph& graph);
// Listado de estaciones (sin conexiones) para GET /api/stations.
std::string stationsToJsonString(const Graph& graph);
std::string routeToJsonString(const Graph& graph, const Route& route);
std::string routesToJsonString(const Graph& graph, const std::vector<Route>& routes);
std::string traceToJsonString(const Graph& graph,
                              const std::vector<TraceEvent>& trace,
                              const AlgorithmStats& stats);

// Documento de exportación: grafo completo + ruta seleccionada + metadatos.
// alternatives se incluye solo si no está vacío.
std::string exportToJsonString(const Graph& graph, const Route& route,
                               const std::vector<Route>& alternatives,
                               const std::string& fromName,
                               const std::string& toName,
                               const std::string& criterion,
                               const std::vector<int>& closedConnections = {});

}  // namespace mf::jsonio
