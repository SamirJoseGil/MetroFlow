#pragma once

#include <string>

#include "Graph.hpp"

namespace mf {

// Carga la red desde los archivos JSON del proyecto.
// No depende de Crow: el motor puede probarse sin la API ni el navegador.
class DataLoader {
public:
    // stationsPath -> data/stations.json, connectionsPath -> data/connections.json
    static Graph loadFromJson(const std::string& stationsPath,
                              const std::string& connectionsPath);
};

}  // namespace mf
