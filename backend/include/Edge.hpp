#pragma once

#include <string>

namespace mf {

// Arista dirigida y ponderada del grafo de transporte.
// Cada tramo físico del sistema produce dos aristas (ida y vuelta); el modelo
// permite que los pesos difieran entre sentidos aunque hoy sean simétricos.
struct Edge {
    int from = -1;
    int to = -1;
    std::string line;         // línea de transporte: "A", "B", ...
    double timeMin = 0.0;     // costo principal: minutos estimados de viaje
    double distanceKm = 0.0;  // distancia geográfica estimada
    std::string type;         // "travel" (viaje)
    bool available = true;    // permite simular cierres de tramo
};

}  // namespace mf
