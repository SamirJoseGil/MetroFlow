#pragma once

#include <string>
#include <vector>

namespace mf {

// Un tramo del recorrido: una arista concreta con su línea y costo.
struct RouteLeg {
    int from = -1;
    int to = -1;
    std::string line;
    double timeMin = 0.0;
    double distanceKm = 0.0;
    std::string type;
};

// Ruta resuelta, lista para serializar a JSON o dibujar en el SVG.
struct Route {
    bool found = false;
    std::vector<int> stations;       // ids en orden de recorrido
    std::vector<RouteLeg> legs;      // size = stations.size() - 1
    int transfers = 0;               // cambios de línea
    int stops = 0;                   // conexiones recorridas
    double totalMin = 0.0;
    double totalKm = 0.0;
    std::string criterion;           // "time" | "hops" | "time_transfer_aware"
};

}  // namespace mf
