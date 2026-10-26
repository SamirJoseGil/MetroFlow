#include "Serialize.hpp"

#include <cmath>
#include <ctime>
#include <iomanip>
#include <sstream>

#include "nlohmann/json.hpp"

namespace mf::jsonio {

namespace {

using nlohmann::json;

json stationJson(const Station& s) {
    return json{{"id", s.id},
                {"name", s.name},
                {"lines", s.lines},
                {"lat", s.lat},
                {"lng", s.lng},
                {"municipio", s.municipio},
                {"position", s.position},
                {"terminal", s.terminal},
                {"interchanges", s.interchanges}};
}

json edgeJson(const Graph& graph, const Edge& e, int index) {
    json j{{"id", index},
           {"from", e.from},
           {"to", e.to},
           {"fromName", graph.station(e.from).name},
           {"toName", graph.station(e.to).name},
           {"line", e.line},
           {"timeMin", e.timeMin},
           {"distanceKm", e.distanceKm},
           {"type", e.type},
           {"available", e.available}};
    return j;
}

json statsJson(const AlgorithmStats& stats) {
    return json{{"pushes", stats.pushes},
                {"extractions", stats.extractions},
                {"relaxations", stats.relaxations},
                {"updates", stats.updates},
                {"staleEntries", stats.staleEntries},
                {"settledNodes", stats.settledNodes},
                {"elapsedMs", stats.elapsedMs}};
}

json traceEventJson(const Graph& graph, const TraceEvent& ev) {
    auto finiteOr = [](double v) -> json {
        if (std::isfinite(v)) return v;
        return -1.0;
    };
    json j{{"type", toString(ev.type)},
           {"node", ev.node},
           {"from", ev.from},
           {"dist", finiteOr(ev.dist)},
           {"previous", finiteOr(ev.previous)},
           {"line", ev.line},
           {"note", ev.note}};
    if (ev.node >= 0 && ev.node < graph.stationCount()) {
        j["nodeName"] = graph.station(ev.node).name;
    }
    if (ev.from >= 0 && ev.from < graph.stationCount()) {
        j["fromName"] = graph.station(ev.from).name;
    }
    if (!ev.fromLine.empty()) j["fromLine"] = ev.fromLine;
    if (ev.previousFrom >= 0) j["previousFrom"] = ev.previousFrom;
    if (!ev.previousFromLine.empty()) j["previousFromLine"] = ev.previousFromLine;
    return j;
}

}  // namespace

std::string stationToJsonString(const Station& station) {
    return stationJson(station).dump(2);
}

std::string graphToJsonString(const Graph& graph) {
    json stations = json::array();
    for (const Station& s : graph.stations()) stations.push_back(stationJson(s));

    json edges = json::array();
    const auto &egs = graph.edges();
    for (size_t i = 0; i < egs.size(); ++i) edges.push_back(edgeJson(graph, egs[i], (int)i));

    json result{
        {"transferPenaltyMin", graph.transferPenaltyMin()},
        {"lines", graph.lines()},
        {"stationCount", graph.stationCount()},
        {"edgeCount", graph.edgeCount()},
        {"stations", stations},
        {"connections", edges}};
    return result.dump(2);
}

std::string stationsToJsonString(const Graph& graph) {
    json stations = json::array();
    for (const Station& s : graph.stations()) stations.push_back(stationJson(s));

    json result{{"stationCount", graph.stationCount()},
                {"lines", graph.lines()},
                {"stations", stations}};
    return result.dump(2);
}

std::string routeToJsonString(const Graph& graph, const Route& route) {
    json j;
    j["found"] = route.found;
    j["criterion"] = route.criterion;
    j["totalMin"] = route.totalMin;
    j["totalKm"] = route.totalKm;
    j["stops"] = route.stops;
    j["transfers"] = route.transfers;

    json stations = json::array();
    for (const int id : route.stations) {
        stations.push_back(
            json{{"id", id}, {"name", graph.station(id).name}});
    }
    j["stations"] = stations;

    json legs = json::array();
    for (const RouteLeg& leg : route.legs) {
        legs.push_back(json{{"from", leg.from},
                            {"to", leg.to},
                            {"fromName", graph.station(leg.from).name},
                            {"toName", graph.station(leg.to).name},
                            {"line", leg.line},
                            {"timeMin", leg.timeMin},
                            {"distanceKm", leg.distanceKm},
                            {"type", leg.type}});
    }
    j["legs"] = legs;
    return j.dump(2);
}

std::string routesToJsonString(const Graph& graph,
                               const std::vector<Route>& routes) {
    json array = json::array();
    for (const Route& route : routes) {
        array.push_back(json::parse(routeToJsonString(graph, route)));
    }
    return array.dump(2);
}

std::string traceToJsonString(const Graph& graph,
                              const std::vector<TraceEvent>& trace,
                              const AlgorithmStats& stats) {
    json events = json::array();
    for (const TraceEvent& ev : trace) events.push_back(traceEventJson(graph, ev));
    json j{{"stats", statsJson(stats)}, {"events", events}};
    return j.dump(2);
}

std::string exportToJsonString(const Graph& graph, const Route& route,
                               const std::vector<Route>& alternatives,
                               const std::string& fromName,
                               const std::string& toName,
                               const std::string& criterion,
                               const std::vector<int>& closedConnections) {
    const std::time_t now = std::time(nullptr);
    std::tm tmBuf{};
#if defined(_WIN32)
    localtime_s(&tmBuf, &now);
#else
    localtime_r(&now, &tmBuf);
#endif
    std::ostringstream stamp;
    stamp << std::put_time(&tmBuf, "%Y-%m-%dT%H:%M:%S");

    json result{
        {"application", "MetroFlow"},
        {"schema", "metroflow.route.v1"},
        {"exportedAt", stamp.str()},
        {"criterion", criterion},
        {"from", fromName},
        {"to", toName},
        {"transferPenaltyMin", graph.transferPenaltyMin()},
        {"route", json::parse(routeToJsonString(graph, route))},
        {"graph", json::parse(graphToJsonString(graph))}};

    if (!alternatives.empty()) {
        result["alternatives"] =
            json::parse(routesToJsonString(graph, alternatives));
    }
    if (!closedConnections.empty()) {
        json closed = json::array();
        const auto &egs = graph.edges();
        for (int id : closedConnections) {
            if (id >= 0 && id < (int)egs.size()) {
                const auto &e = egs[id];
                closed.push_back(json{{"id", id},
                                      {"from", e.from},
                                      {"to", e.to},
                                      {"fromName", graph.station(e.from).name},
                                      {"toName", graph.station(e.to).name},
                                      {"line", e.line}});
            }
        }
        if (!closed.empty()) result["closedConnections"] = closed;
    }
    return result.dump(2);
}

}  // namespace mf::jsonio
