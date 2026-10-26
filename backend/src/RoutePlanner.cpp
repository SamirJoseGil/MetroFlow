#include "RoutePlanner.hpp"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <optional>
#include <queue>
#include <string>
#include <unordered_map>
#include <utility>

namespace mf {

namespace {

// Construye una Route a partir de una secuencia ordenada de índices de arista.
// transferPenalty se suma a totalMin en cada cambio de línea para que el costo
// reportado coincida con la función objetivo que minimizó el algoritmo.
Route buildRoute(const Graph& graph, int source,
                 const std::vector<int>& edgeIndices, std::string criterion,
                 double transferPenalty = 0.0) {
    Route route;
    route.found = true;
    route.criterion = std::move(criterion);
    route.stations.push_back(source);

    std::string previousLine;
    for (const int edgeIndex : edgeIndices) {
        const Edge& e = graph.edge(edgeIndex);
        RouteLeg leg;
        leg.from = e.from;
        leg.to = e.to;
        leg.line = e.line;
        leg.timeMin = e.timeMin;
        leg.distanceKm = e.distanceKm;
        leg.type = e.type;
        route.legs.push_back(leg);
        route.totalMin += e.timeMin;
        route.totalKm += e.distanceKm;
        route.stations.push_back(e.to);

        if (!previousLine.empty() && previousLine != e.line) {
            ++route.transfers;
            route.totalMin += transferPenalty;
        }
        previousLine = e.line;
    }
    route.stops = static_cast<int>(route.legs.size());
    return route;
}

// Reconstruye los índices de arista desde target hasta source usando el árbol
// de predecesores que dejó Dijkstra (parent y parentEdge).
std::vector<int> reconstructEdges(const std::vector<int>& parent,
                                  const std::vector<int>& parentEdge,
                                  int source, int target) {
    std::vector<int> edges;
    int current = target;
    while (current != source && current != -1) {
        const int edgeIndex = parentEdge[static_cast<size_t>(current)];
        if (edgeIndex < 0) return {};
        edges.push_back(edgeIndex);
        current = parent[static_cast<size_t>(current)];
    }
    std::reverse(edges.begin(), edges.end());
    return edges;
}

}  // namespace

// ---------------------------------------------------------------------------
// StateDij: motor compartido por fastest() y dijkstraTrace(). Es un Dijkstra
// sobre el grafo de estados (estación, línea): el costo de una arista depende
// de la línea actual, porque cambiar de línea implica un transbordo. Un
// Dijkstra plano sobre estaciones no sería correcto aquí: el costo no
// dependería solo de la distancia acumulada. Con record = true emite
// TraceEvent para el laboratorio visual, garantizando que la traza siempre
// coincida con la ruta que reporta fastest().
// ---------------------------------------------------------------------------
class StateDij {
public:
    explicit StateDij(const Graph& graph) : graph_(graph) {}

    void runTrace(int source, int target, bool record) {
        const auto t0 = std::chrono::steady_clock::now();
        source_ = source;
        target_ = target;
        emit_ = record;
        prepare();

        if (valid_) {
            emit(TraceType::Init, source, -1, 0.0, kInfinity, "",
                 "origen inicializado en 0; resto en infinito");

            // Estados iniciales: el origen "a bordo" de cualquiera de sus
            // líneas tiene costo 0 (aún no se ha viajado).
            for (const std::string& line : graph_.station(source).lines) {
                const auto it = lineId_.find(line);
                if (it != lineId_.end()) {
                    const int s = stateOf(source, it->second);
                    dist_[static_cast<size_t>(s)] = 0.0;
                    pq_.push({0.0, s});
                    ++stats.pushes;
                    emit(TraceType::Push, source, -1, 0.0, kInfinity, line,
                         "estado inicial del origen");
                }
            }
            // Salvaguarda: si la estación origen no declarara líneas, usar
            // las líneas de sus aristas.
            if (pq_.empty()) {
                for (const int edgeIndex : graph_.outEdges(source)) {
                    const int s =
                        stateOf(source, lineId_[graph_.edge(edgeIndex).line]);
                    dist_[static_cast<size_t>(s)] = 0.0;
                    pq_.push({0.0, s});
                    ++stats.pushes;
                    emit(TraceType::Push, source, -1, 0.0, kInfinity,
                         graph_.edge(edgeIndex).line, "estado inicial del origen");
                }
            }

            while (!pq_.empty()) {
                const Item top = pq_.top();
                pq_.pop();
                ++stats.extractions;
                const size_t idx = static_cast<size_t>(top.second);
                if (top.first > dist_[idx]) {
                    ++stats.staleEntries;
                    emit(TraceType::Skip, stateStation(top.second), -1,
                         top.first, dist_[idx], stateLine(top.second),
                         "entrada obsoleta descartada (lazy deletion)");
                    continue;
                }
                ++stats.settledNodes;
                emit(TraceType::Extract, stateStation(top.second), -1,
                     top.first, top.first, stateLine(top.second),
                     "estado extraído con la menor distancia provisional");

                // Al asentar cualquier estado de la estación destino, ese es
                // el mejor estado de llegada: el resto de estados de la misma
                // estación solo puede asentarse con distancia mayor o igual.
                if (stateStation(top.second) == target_) {
                    bestState_ = top.second;
                    break;
                }
                relaxState(top.second);
            }

            if (bestState_ < 0 && valid_) {
                // Mejor estado de llegada: la línea con la que convenga terminar.
                double best = kInfinity;
                for (int line = 0; line < lineCount_; ++line) {
                    const int s = stateOf(target_, line);
                    if (dist_[static_cast<size_t>(s)] < best) {
                        best = dist_[static_cast<size_t>(s)];
                        bestState_ = s;
                    }
                }
            }
        }

        // Eventos Path por cada tramo de la ruta reconstruida.
        if (emit_ && bestState_ >= 0 &&
            dist_[static_cast<size_t>(bestState_)] < kInfinity) {
            const Route route = this->route();
            for (const RouteLeg& leg : route.legs) {
                emit(TraceType::Path, leg.to, leg.from,
                     dist_[static_cast<size_t>(bestState_)], leg.timeMin,
                     leg.line, "tramo reconstruido de la ruta final");
            }
        }

        const auto t1 = std::chrono::steady_clock::now();
        stats.elapsedMs =
            std::chrono::duration<double, std::milli>(t1 - t0).count();
    }

    Route route() const {
        if (!valid_ || bestState_ < 0 ||
            dist_[static_cast<size_t>(bestState_)] >= kInfinity) {
            return Route{};
        }
        std::vector<int> edges;
        int current = bestState_;
        while (parentEdge_[static_cast<size_t>(current)] != -1) {
            edges.push_back(parentEdge_[static_cast<size_t>(current)]);
            current = parentState_[static_cast<size_t>(current)];
        }
        std::reverse(edges.begin(), edges.end());
        return buildRoute(graph_, source_, edges, "time_transfer_aware",
                          penalty_);
    }

    AlgorithmStats stats;
    std::vector<TraceEvent> trace;

private:
    using Item = std::pair<double, int>;  // (costo provisional, estado)

    void prepare() {
        valid_ = false;
        const int n = graph_.stationCount();
        if (source_ < 0 || source_ >= n || target_ < 0 || target_ >= n) return;

        // Asignamos un índice a cada línea presente en la red.
        lineNames_ = graph_.lines();
        lineId_.clear();
        for (int i = 0; i < static_cast<int>(lineNames_.size()); ++i) {
            lineId_[lineNames_[static_cast<size_t>(i)]] = i;
        }
        lineCount_ = static_cast<int>(lineNames_.size());
        if (lineCount_ == 0) return;
        penalty_ = graph_.transferPenaltyMin();

        const size_t stateCount =
            static_cast<size_t>(n) * static_cast<size_t>(lineCount_);
        dist_.assign(stateCount, kInfinity);
        parentState_.assign(stateCount, -1);
        parentEdge_.assign(stateCount, -1);
        bestState_ = -1;
        valid_ = true;
    }

    void relaxState(int state) {
        const int station = stateStation(state);
        const int lineId = stateLineId(state);
        const double d = dist_[static_cast<size_t>(state)];

        for (const int edgeIndex : graph_.outEdges(station)) {
            const Edge& e = graph_.edge(edgeIndex);
            // Un tramo cerrado no se puede recorrer.
            if (!e.available) continue;
            const int nextLine = lineId_[e.line];
            const double transferCost = (nextLine == lineId) ? 0.0 : penalty_;
            const double candidate = d + transferCost + e.timeMin;
            const int nextState = stateOf(e.to, nextLine);
            ++stats.relaxations;

            if (emit_) {
                TraceEvent ev;
                ev.type = TraceType::Relax;
                ev.node = e.to;
                ev.from = station;
                ev.fromLine = stateLine(state);
                ev.dist = candidate;
                ev.previous = dist_[static_cast<size_t>(nextState)];
                ev.line = e.line;
                ev.note = "conexión examinada";
                trace.push_back(std::move(ev));
            }

            if (candidate < dist_[static_cast<size_t>(nextState)] - 1e-9) {
                const double previous = dist_[static_cast<size_t>(nextState)];
                const int prevState = parentState_[static_cast<size_t>(nextState)];
                dist_[static_cast<size_t>(nextState)] = candidate;
                parentState_[static_cast<size_t>(nextState)] = state;
                parentEdge_[static_cast<size_t>(nextState)] = edgeIndex;
                ++stats.updates;
                pq_.push({candidate, nextState});
                ++stats.pushes;
                if (emit_) {
                    TraceEvent upd;
                    upd.type = TraceType::UpdateDist;
                    upd.node = e.to;
                    upd.from = station;
                    upd.fromLine = stateLine(state);
                    upd.dist = candidate;
                    upd.previous = previous;
                    upd.line = e.line;
                    upd.note = "distancia mejorada";
                    if (prevState >= 0) {
                        upd.previousFrom = stateStation(prevState);
                        upd.previousFromLine = stateLine(prevState);
                    }
                    trace.push_back(std::move(upd));

                    TraceEvent upPar;
                    upPar.type = TraceType::UpdateParent;
                    upPar.node = e.to;
                    upPar.from = station;
                    upPar.fromLine = stateLine(state);
                    upPar.dist = candidate;
                    upPar.previous = previous;
                    upPar.line = e.line;
                    upPar.note = "predecesor actualizado";
                    if (prevState >= 0) {
                        upPar.previousFrom = stateStation(prevState);
                        upPar.previousFromLine = stateLine(prevState);
                    }
                    trace.push_back(std::move(upPar));
                }
            }
        }
    }

    void emit(TraceType type, int node, int from, double dist, double previous,
              std::string line, std::string note) {
        if (!emit_) return;
        TraceEvent ev;
        ev.type = type;
        ev.node = node;
        ev.from = from;
        ev.dist = dist;
        ev.previous = previous;
        ev.line = std::move(line);
        ev.note = std::move(note);
        trace.push_back(std::move(ev));
    }

    int stateStation(int state) const { return state / lineCount_; }
    int stateLineId(int state) const { return state % lineCount_; }
    const std::string& stateLine(int state) const {
        return lineNames_[static_cast<size_t>(stateLineId(state))];
    }
    int stateOf(int station, int line) const {
        return station * lineCount_ + line;
    }

    const Graph& graph_;
    std::vector<std::string> lineNames_;
    std::unordered_map<std::string, int> lineId_;
    int lineCount_ = 0;
    double penalty_ = 0.0;
    int source_ = -1;
    int target_ = -1;
    bool valid_ = false;
    bool emit_ = false;
    std::vector<double> dist_;
    std::vector<int> parentState_;
    std::vector<int> parentEdge_;
    int bestState_ = -1;
    std::priority_queue<Item, std::vector<Item>, std::greater<Item>> pq_;
};

// ---------------------------------------------------------------------------
// fastest: usa el mismo motor StateDij que dijkstraTrace(), de modo que la
// traza del laboratorio y esta ruta siempre coinciden.
// ---------------------------------------------------------------------------
Route RoutePlanner::fastest(int from, int to) const {
    StateDij engine(graph_);
    engine.runTrace(from, to, false);
    return engine.route();
}

// ---------------------------------------------------------------------------
// fewestStops: camino con menos conexiones (BFS).
// ---------------------------------------------------------------------------
Route RoutePlanner::fewestStops(int from, int to) const {
    const BfsResult bfs = Bfs::compute(graph_, from, to);
    if (!bfs.hasPath(to)) {
        return Route{};
    }
    const std::vector<int> edges =
        reconstructEdges(bfs.parent, bfs.parentEdge, from, to);
    return buildRoute(graph_, from, edges, "hops", graph_.transferPenaltyMin());
}

// ---------------------------------------------------------------------------
// alternatives: k rutas más cortas por tiempo (algoritmo de Yen).
// ---------------------------------------------------------------------------
namespace {

struct Path {
    std::vector<int> stations;
    std::vector<int> edges;
    double cost = 0.0;
};

std::optional<Path> dijkstraPath(const Graph& graph, int source, int target,
                                 const std::vector<bool>& bannedEdges,
                                 const std::vector<bool>& bannedNodes) {
    const DijkstraResult result = Dijkstra::computeFiltered(
        graph, source, target, bannedEdges, bannedNodes);
    if (!result.hasPath(target)) {
        return std::nullopt;
    }
    Path path;
    path.edges =
        reconstructEdges(result.parent, result.parentEdge, source, target);
    path.stations.push_back(source);
    for (const int edgeIndex : path.edges) {
        const Edge& e = graph.edge(edgeIndex);
        path.cost += e.timeMin;
        path.stations.push_back(e.to);
    }
    return path;
}

bool samePrefix(const Path& path, const std::vector<int>& prefix) {
    if (path.stations.size() < prefix.size()) return false;
    return std::equal(prefix.begin(), prefix.end(), path.stations.begin());
}

bool sameStations(const Path& a, const Path& b) {
    return a.stations == b.stations;
}

// Costo total incluyendo la penalización por cada cambio de línea. Es la misma
// función objetivo que minimiza fastest(); se usa para ordenar las alternativas
// de forma consistente con el criterio "menor tiempo".
double transferAwareTotal(const Graph& graph, const std::vector<int>& edges,
                          double penalty, int& transfersOut) {
    double total = 0.0;
    int transfers = 0;
    std::string previousLine;
    for (const int edgeIndex : edges) {
        const Edge& e = graph.edge(edgeIndex);
        total += e.timeMin;
        if (!previousLine.empty() && previousLine != e.line) {
            total += penalty;
            ++transfers;
        }
        previousLine = e.line;
    }
    transfersOut = transfers;
    return total;
}

// Recupera los índices de arista de una Route ya construida (para reutilizar el
// camino de fastest() como semilla de las alternativas).
std::vector<int> edgesOfRoute(const Graph& graph, const Route& route) {
    std::vector<int> edges;
    edges.reserve(route.legs.size());
    for (const RouteLeg& leg : route.legs) {
        int found = -1;
        for (const int edgeIndex : graph.outEdges(leg.from)) {
            const Edge& e = graph.edge(edgeIndex);
            if (e.to == leg.to && e.line == leg.line) {
                found = edgeIndex;
                break;
            }
        }
        if (found < 0) return {};
        edges.push_back(found);
    }
    return edges;
}

}  // namespace

std::vector<Route> RoutePlanner::alternatives(int from, int to, int k) const {
    const Graph& graph = graph_;
    std::vector<Route> routes;
    if (k < 1) k = 1;
    if (from < 0 || from >= graph.stationCount() || to < 0 ||
        to >= graph.stationCount()) {
        return routes;
    }
    if (from == to) {
        return routes;
    }

    const std::vector<bool> noEdges(static_cast<size_t>(graph.edgeCount()), false);
    const std::vector<bool> noNodes(static_cast<size_t>(graph.stationCount()), false);

    const auto first = dijkstraPath(graph, from, to, noEdges, noNodes);
    if (!first.has_value()) {
        return routes;
    }

    std::vector<Path> accepted;
    accepted.push_back(*first);

    while (static_cast<int>(accepted.size()) < k) {
        const Path& previous = accepted.back();
        std::vector<Path> candidates;

        for (size_t i = 0; i + 1 < previous.stations.size(); ++i) {
            const int spurNode = previous.stations[i];
            const std::vector<int> rootStations(previous.stations.begin(),
                                                previous.stations.begin() + static_cast<long>(i) + 1);
            const std::vector<int> rootEdges(previous.edges.begin(),
                                             previous.edges.begin() + static_cast<long>(i));

            std::vector<bool> bannedEdges(static_cast<size_t>(graph.edgeCount()), false);
            for (const Path& path : accepted) {
                if (samePrefix(path, rootStations) && i < path.edges.size()) {
                    bannedEdges[static_cast<size_t>(path.edges[i])] = true;
                }
            }

            std::vector<bool> bannedNodes(static_cast<size_t>(graph.stationCount()), false);
            for (size_t j = 0; j < i; ++j) {
                bannedNodes[static_cast<size_t>(rootStations[j])] = true;
            }

            const auto spur = dijkstraPath(graph, spurNode, to, bannedEdges, bannedNodes);
            if (!spur.has_value()) continue;

            Path candidate;
            candidate.stations = rootStations;
            candidate.stations.pop_back();  // se completará con el camino espurio
            candidate.stations.insert(candidate.stations.end(),
                                      spur->stations.begin(), spur->stations.end());
            candidate.edges = rootEdges;
            candidate.edges.insert(candidate.edges.end(), spur->edges.begin(),
                                   spur->edges.end());

            const double rootCost =
                [&] {
                    double sum = 0.0;
                    for (const int edgeIndex : rootEdges) {
                        sum += graph.edge(edgeIndex).timeMin;
                    }
                    return sum;
                }();
            candidate.cost = rootCost + spur->cost;

            const bool duplicate =
                std::any_of(candidates.begin(), candidates.end(),
                            [&](const Path& p) { return sameStations(p, candidate); }) ||
                std::any_of(accepted.begin(), accepted.end(),
                            [&](const Path& p) { return sameStations(p, candidate); });
            if (!duplicate) {
                candidates.push_back(std::move(candidate));
            }
        }

        if (candidates.empty()) break;

        const auto best = std::min_element(
            candidates.begin(), candidates.end(),
            [](const Path& a, const Path& b) { return a.cost < b.cost; });
        accepted.push_back(*best);
    }

    // La ruta más rápida real (consciente de transbordos) puede no coincidir con
    // la de menor tiempo de viaje puro; se incorpora como semilla para que el
    // orden y el tiempo reportado sean consistentes con fastest().
    {
        const Route fast = fastest(from, to);
        if (fast.found) {
            std::vector<int> fastEdges = edgesOfRoute(graph, fast);
            if (!fastEdges.empty()) {
                Path seed;
                seed.edges = std::move(fastEdges);
                seed.stations.push_back(from);
                for (const int edgeIndex : seed.edges) {
                    seed.stations.push_back(graph.edge(edgeIndex).to);
                }
                accepted.push_back(std::move(seed));
            }
        }
    }

    // Eliminar duplicados por secuencia física de estaciones.
    std::vector<Path> unique;
    for (Path& path : accepted) {
        bool duplicate = false;
        for (const Path& kept : unique) {
            if (sameStations(path, kept)) {
                duplicate = true;
                break;
            }
        }
        if (!duplicate) unique.push_back(std::move(path));
    }

    // Reordenar por la función objetivo real (incluye la penalización/transbordo)
    // y reportar ese mismo costo, para no contradecir a fastest().
    const double penalty = graph.transferPenaltyMin();
    for (Path& path : unique) {
        int transfers = 0;
        path.cost = transferAwareTotal(graph, path.edges, penalty, transfers);
    }
    std::sort(unique.begin(), unique.end(),
              [](const Path& a, const Path& b) { return a.cost < b.cost; });

    for (const Path& path : unique) {
        if (static_cast<int>(routes.size()) >= k) break;
        routes.push_back(
            buildRoute(graph, from, path.edges, "time_alternative", penalty));
    }
    return routes;
}

TraceResult RoutePlanner::dijkstraTrace(int from, int to, bool record) const {
    TraceResult tr;
    StateDij sd(graph_);
    sd.runTrace(from, to, record);
    tr.stats = sd.stats;
    tr.trace = std::move(sd.trace);
    return tr;
}

TraceResult RoutePlanner::bfsTrace(int from, int to, bool record) const {
    TraceResult tr;
    const BfsResult res = Bfs::compute(graph_, from, to, record);
    tr.stats = res.stats;
    tr.trace = res.trace;
    return tr;
}

}  // namespace mf
