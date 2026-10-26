#pragma once

#include <string>
#include <vector>

namespace mf {

// Tipos de evento que produce la ejecución de un algoritmo. Almacenarlos como
// datos (y no imprimirlos) permite que el frontend reproduzca el algoritmo
// paso a paso, y que las pruebas inspeccionen su comportamiento.
enum class TraceType {
    Init,          // inicialización de distancias y predecesores
    Push,          // estación insertada en la cola de prioridad
    Extract,       // estación extraída con la distancia mínima provisional
    Skip,          // entrada obsoleta descartada (lazy deletion)
    Relax,         // examen de una conexión saliente
    UpdateDist,    // mejora de la distancia mínima conocida
    UpdateParent,  // cambio de predecesor (se reconstruye la ruta)
    Path           // reconstrucción de la ruta final
};

struct TraceEvent {
    TraceType type = TraceType::Init;
    int node = -1;           // estación involucrada
    int from = -1;           // en Relax: origen de la conexión examinada
    double dist = 0.0;       // distancia resultante (o provisional)
    double previous = 0.0;   // distancia previa, en actualizaciones
    std::string line;        // línea de la conexión o estado (Relax / Extract / Path)
    std::string note;        // texto legible opcional para la interfaz
    // Extensión para grafo de estados (estación, línea)
    std::string fromLine;
    int previousFrom = -1;
    std::string previousFromLine;
};

// Métricas de ejecución: alimentan el panel de estadísticas y el reporte.
struct AlgorithmStats {
    long long pushes = 0;
    long long extractions = 0;
    long long relaxations = 0;
    long long updates = 0;
    long long staleEntries = 0;
    int settledNodes = 0;
    double elapsedMs = 0.0;
};

inline const char* toString(TraceType type) {
    switch (type) {
        case TraceType::Init: return "init";
        case TraceType::Push: return "push";
        case TraceType::Extract: return "extract";
        case TraceType::Skip: return "skip";
        case TraceType::Relax: return "relax";
        case TraceType::UpdateDist: return "update_dist";
        case TraceType::UpdateParent: return "update_parent";
        case TraceType::Path: return "path";
    }
    return "unknown";
}

}  // namespace mf
