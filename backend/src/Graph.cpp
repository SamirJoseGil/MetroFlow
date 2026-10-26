#include "Graph.hpp"

#include <algorithm>
#include <stdexcept>

namespace mf {

int Graph::addStation(const Station& station) {
    const int id = static_cast<int>(stations_.size());
    Station copy = station;
    copy.id = id;
    stations_.push_back(std::move(copy));
    nameToId_[stations_.back().name] = id;
    adjacency_.emplace_back();
    return id;
}

void Graph::addEdge(const Edge& edge) {
    if (edge.from < 0 || edge.from >= stationCount() ||
        edge.to < 0 || edge.to >= stationCount()) {
        throw std::out_of_range("Graph::addEdge: id de estación fuera de rango");
    }
    const int index = static_cast<int>(edges_.size());
    edges_.push_back(edge);
    adjacency_[static_cast<size_t>(edge.from)].push_back(index);
}

int Graph::idOf(const std::string& name) const {
    const auto it = nameToId_.find(name);
    if (it == nameToId_.end()) {
        throw std::out_of_range("Graph::idOf: estación desconocida: " + name);
    }
    return it->second;
}

std::vector<std::string> Graph::lines() const {
    std::vector<std::string> result;
    for (const Edge& e : edges_) {
        if (std::find(result.begin(), result.end(), e.line) == result.end()) {
            result.push_back(e.line);
        }
    }
    std::sort(result.begin(), result.end());
    return result;
}

void Graph::setEdgeAvailable(int edgeIndex, bool available) {
    if (edgeIndex >= 0 && edgeIndex < (int)edges_.size()) {
        edges_[edgeIndex].available = available;
    }
}

}  // namespace mf
