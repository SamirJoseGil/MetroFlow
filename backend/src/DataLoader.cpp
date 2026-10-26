#include "DataLoader.hpp"

#include <fstream>
#include <stdexcept>

#include "nlohmann/json.hpp"

namespace mf {

namespace {

std::string readFile(const std::string& path) {
    std::ifstream in(path, std::ios::binary);
    if (!in) {
        throw std::runtime_error("DataLoader: no se pudo abrir " + path);
    }
    return std::string((std::istreambuf_iterator<char>(in)),
                       std::istreambuf_iterator<char>());
}

}  // namespace

Graph DataLoader::loadFromJson(const std::string& stationsPath,
                               const std::string& connectionsPath) {
    using nlohmann::json;

    const json stationsDoc = json::parse(readFile(stationsPath));
    const json connectionsDoc = json::parse(readFile(connectionsPath));

    Graph graph;

    for (const auto& s : stationsDoc.at("stations")) {
        Station station;
        station.name = s.at("name").get<std::string>();
        station.lines = s.value("lines", std::vector<std::string>{});
        station.lat = s.value("lat", 0.0);
        station.lng = s.value("lng", 0.0);
        station.municipio = s.value("municipio", std::string{});
        station.position = s.value("position", std::string{});
        station.terminal = s.value("terminal", false);
        station.interchanges =
            s.value("interchanges", std::vector<std::string>{});
        graph.addStation(station);
    }

    if (connectionsDoc.contains("transfer_penalty_min")) {
        graph.setTransferPenaltyMin(
            connectionsDoc.at("transfer_penalty_min").get<double>());
    }

    for (const auto& c : connectionsDoc.at("connections")) {
        Edge edge;
        edge.from = c.at("from").get<int>();
        edge.to = c.at("to").get<int>();
        edge.line = c.at("line").get<std::string>();
        edge.timeMin = c.at("time_min").get<double>();
        edge.distanceKm = c.value("distance_km", 0.0);
        edge.type = c.value("type", std::string{"travel"});
        edge.available = c.value("available", true);
        graph.addEdge(edge);
    }

    return graph;
}

}  // namespace mf
