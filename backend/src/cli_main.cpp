// MetroFlow - interfaz de línea de comandos del motor.
//
// Permite probar el núcleo algorítmico por completo sin la API ni el navegador:
// carga el grafo desde los JSON, calcula rutas y produce JSON por stdout.
//
// Ejemplos:
//   metroflow_cli stations
//   metroflow_cli route --from "Niquía" --to "La Estrella"
//   metroflow_cli route --from "Niquía" --to "San Javier" --criterion hops
//   metroflow_cli route --from "Niquía" --to "San Javier" --k 3
//   metroflow_cli compare --from "Niquía" --to "San Javier"
//   metroflow_cli route --from "Acevedo" --to "Poblado" --trace

#include <algorithm>
#include <cctype>
#include <iostream>
#include <map>
#include <string>
#include <vector>

#include "DataLoader.hpp"
#include "RoutePlanner.hpp"
#include "Serialize.hpp"

namespace {

struct Options {
    std::string dataDir = "data";
    std::string command;
    std::map<std::string, std::string> flags;
    bool has(const std::string& key) const { return flags.count(key) > 0; }
    std::string get(const std::string& key, const std::string& def = "") const {
        auto it = flags.find(key);
        return it == flags.end() ? def : it->second;
    }
};

Options parseArgs(int argc, char** argv) {
    Options options;
    for (int i = 1; i < argc; ++i) {
        const std::string arg = argv[i];
        if (arg == "--data") {
            if (i + 1 < argc) options.dataDir = argv[++i];
        } else if (arg.rfind("--", 0) == 0) {
            const std::string key = arg.substr(2);
            if (i + 1 < argc && std::string(argv[i + 1]).rfind("--", 0) != 0) {
                options.flags[key] = argv[++i];
            } else {
                options.flags[key] = "true";
            }
        } else if (options.command.empty()) {
            options.command = arg;
        }
    }
    return options;
}

void printError(const std::string& message) {
    std::cerr << "error: " << message << "\n";
}

// true si la cadena está formada solo por dígitos (interpretable como id).
// std::isdigit recibe unsigned char para evitar comportamiento indefinido con
// caracteres de valor negativo (bytes UTF-8).
bool allDigits(const std::string& s) {
    return !s.empty() && std::all_of(s.begin(), s.end(), [](unsigned char c) {
               return std::isdigit(c) != 0;
           });
}

int resolveId(const mf::Graph& graph, const std::string& value) {
    return allDigits(value) ? std::stoi(value) : graph.idOf(value);
}

}  // namespace

int main(int argc, char** argv) {
    const Options options = parseArgs(argc, argv);

    if (options.command.empty()) {
        printError(
            "uso: metroflow_cli [--data DIR] <stations|graph|route|compare> ...");
        return 1;
    }

    mf::Graph graph;
    try {
        graph = mf::DataLoader::loadFromJson(
            options.dataDir + "/stations.json",
            options.dataDir + "/connections.json");
    } catch (const std::exception& ex) {
        printError(ex.what());
        return 1;
    }

    mf::RoutePlanner planner(graph);

    try {
        if (options.command == "stations") {
            for (const mf::Station& s : graph.stations()) {
                std::cout << s.id << "\t" << s.name << "\t[";
                for (size_t i = 0; i < s.lines.size(); ++i) {
                    std::cout << (i ? "," : "") << s.lines[i];
                }
                std::cout << "]\n";
            }
            return 0;
        }

        if (options.command == "graph") {
            std::cout << mf::jsonio::graphToJsonString(graph) << "\n";
            return 0;
        }

        if (options.command == "route") {
            if (!options.has("from") || !options.has("to")) {
                printError("route requiere --from y --to");
                return 1;
            }
            const auto fromStr = options.get("from");
            const auto toStr = options.get("to");
            const int from = resolveId(graph, fromStr);
            const int to = resolveId(graph, toStr);

            const int k = std::stoi(options.get("k", "1"));
            if (k > 1) {
                const auto routes = planner.alternatives(from, to, k);
                std::cout << mf::jsonio::routesToJsonString(graph, routes) << "\n";
                return 0;
            }

            const std::string criterion = options.get("criterion", "time");
            const mf::Route route = (criterion == "hops")
                                        ? planner.fewestStops(from, to)
                                        : planner.fastest(from, to);
            std::cout << mf::jsonio::routeToJsonString(graph, route) << "\n";

            if (options.has("trace")) {
                if (criterion == "hops") {
                    const auto bfs = planner.bfsTrace(from, to, true);
                    std::cout << mf::jsonio::traceToJsonString(graph, bfs.trace,
                                                               bfs.stats)
                              << "\n";
                } else {
                    const auto dij = planner.dijkstraTrace(from, to, true);
                    std::cout << mf::jsonio::traceToJsonString(graph, dij.trace,
                                                               dij.stats)
                              << "\n";
                }
            }
            return 0;
        }

        if (options.command == "compare") {
            if (!options.has("from") || !options.has("to")) {
                printError("compare requiere --from y --to");
                return 1;
            }
            const auto fromStr = options.get("from");
            const auto toStr = options.get("to");
            const int from = resolveId(graph, fromStr);
            const int to = resolveId(graph, toStr);
            const mf::Route timeRoute = planner.fastest(from, to);
            const mf::Route hopsRoute = planner.fewestStops(from, to);

            std::cout << "{\n  \"time\": "
                      << mf::jsonio::routeToJsonString(graph, timeRoute)
                      << ",\n  \"hops\": "
                      << mf::jsonio::routeToJsonString(graph, hopsRoute)
                      << "\n}\n";
            return 0;
        }

        printError("comando desconocido: " + options.command);
        return 1;
    } catch (const std::exception& ex) {
        printError(ex.what());
        return 1;
    }
}
