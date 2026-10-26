#pragma once

#include <string>
#include <unordered_map>
#include <vector>
#include <algorithm>

#include "Edge.hpp"
#include "Station.hpp"

namespace mf {

// Grafo dirigido y ponderado representado con listas de adyacencia.
//
// Estructuras de datos centrales:
//   * std::vector<Station>            -> acceso contiguo por id (0..n-1).
//   * std::unordered_map<string,int>  -> nombre de estación -> id, O(1) medio.
//   * std::vector<std::vector<int>>   -> lista de adyacencia; para cada
//                                        estación guarda los índices de sus
//                                        aristas salientes en edges_.
//
// Guardar índices (en lugar de copias) permite identificar y prohibir aristas
// concretas, algo que necesita el cálculo de rutas alternativas (Yen).
//
// Complejidad de memoria: O(V + E).
class Graph {
public:
    int addStation(const Station& station);
    void addEdge(const Edge& edge);

    int stationCount() const { return static_cast<int>(stations_.size()); }
    int edgeCount() const { return static_cast<int>(edges_.size()); }

    const Station& station(int id) const { return stations_.at(static_cast<size_t>(id)); }
    const std::vector<Station>& stations() const { return stations_; }
    const std::vector<Edge>& edges() const { return edges_; }
    const Edge& edge(int index) const { return edges_.at(static_cast<size_t>(index)); }

    // Índices de las aristas salientes de una estación (lista de adyacencia).
    const std::vector<int>& outEdges(int id) const {
        return adjacency_.at(static_cast<size_t>(id));
    }

    bool hasStation(const std::string& name) const {
        return nameToId_.find(name) != nameToId_.end();
    }

    // id de la estación por nombre. Lanza std::out_of_range si no existe.
    int idOf(const std::string& name) const;

    double transferPenaltyMin() const { return transferPenaltyMin_; }
    void setTransferPenaltyMin(double minutes) { transferPenaltyMin_ = minutes; }

    // Líneas presentes en la red (etiquetas observadas en las aristas).
    std::vector<std::string> lines() const;
    std::vector<Edge>& edgesMutable() { return edges_; }
    void setEdgeAvailable(int edgeIndex, bool available);

private:
    std::vector<Station> stations_;
    std::unordered_map<std::string, int> nameToId_;
    std::vector<std::vector<int>> adjacency_;
    std::vector<Edge> edges_;
    double transferPenaltyMin_ = 3.0;
};

}  // namespace mf
