#include <algorithm>
#include <cstdlib>
#include <cctype>
#include <filesystem>
#include <fstream>
#include <iterator>
#include <string>

#include "DataLoader.hpp"
#include "RoutePlanner.hpp"
#include "Serialize.hpp"
#include "crow.h"

namespace fs = std::filesystem;

static int readPortFromEnv() {
    const char* envPort = std::getenv("PORT");
    if (envPort && *envPort) {
        try {
            int p = std::stoi(envPort);
            if (p > 0 && p < 65536) return p;
        } catch (const std::exception&) {
            // Si PORT no es numérico, se usa el valor por defecto.
        }
    }
    return 18080;
}

static std::string findDataDir() {
    fs::path cwd = fs::current_path();
    for (int up = 0; up < 5; ++up) {
        const fs::path d = cwd / "data";
        const fs::path s = d / "stations.json";
        if (fs::exists(s)) {
            return d.string();
        }
        if (cwd == cwd.root_path()) break;
        cwd = cwd.parent_path();
    }
    return "data";
}

static std::string findDistDir() {
    fs::path cwd = fs::current_path();
    for (int up = 0; up < 5; ++up) {
        const fs::path d = cwd / "frontend" / "dist";
        const fs::path i = d / "index.html";
        if (fs::exists(i)) {
            return d.string();
        }
        if (cwd == cwd.root_path()) break;
        cwd = cwd.parent_path();
    }
    return (fs::current_path() / "frontend" / "dist").string();
}

int main() {
    const std::string dataDir = findDataDir();
    const std::string distDir = findDistDir();

    mf::Graph graph = mf::DataLoader::loadFromJson(
        (fs::path(dataDir) / "stations.json").string(),
        (fs::path(dataDir) / "connections.json").string());

    crow::App<crow::CORSHandler> app;

    auto& cors = app.get_middleware<crow::CORSHandler>();
    cors.global()
        .origin("*")
        .methods("GET"_method, "POST"_method, "OPTIONS"_method)
        .headers("Content-Type", "Authorization", "X-Requested-With")
        .allow_credentials();

    CROW_ROUTE(app, "/api/health")([]() {
        crow::json::wvalue x;
        x["status"] = "ok";
        return x;
    });

    CROW_ROUTE(app, "/api/stations")([&graph]() {
        crow::response r(mf::jsonio::stationsToJsonString(graph));
        r.add_header("Content-Type", "application/json");
        return r;
    });

    CROW_ROUTE(app, "/api/graph")([&graph]() {
        crow::response r(mf::jsonio::graphToJsonString(graph));
        r.add_header("Content-Type", "application/json");
        return r;
    });

    auto readEndpoint = [](const crow::json::rvalue& body, const char* key,
                           std::string& out) {
        if (!body.has(key)) return;
        const auto& v = body[key];
        if (v.t() == crow::json::type::String) {
            out = static_cast<std::string>(v.s());
        } else if (v.t() == crow::json::type::Number) {
            out = std::to_string(static_cast<int>(v.i()));
        }
    };

    auto resolveId = [&graph](const std::string& s) -> int {
        int id = -1;
        // std::isdigit recibe unsigned char para evitar comportamiento
        // indefinido con caracteres de valor negativo (bytes UTF-8).
        const bool numeric = !s.empty() &&
                             std::all_of(s.begin(), s.end(), [](unsigned char c) {
                                 return std::isdigit(c) != 0;
                             });
        if (numeric) {
            id = std::stoi(s);
        } else {
            try {
                id = graph.idOf(s);
            } catch (const std::exception&) {
                return -1;
            }
        }
        if (id < 0 || id >= graph.stationCount()) return -1;
        return id;
    };

    // Lee "closedConnections": ids de aristas (conexiones dirigidas) cerradas
    // solo para esta solicitud. Se descartan ids fuera de rango o duplicados.
    auto readClosedConnections = [&graph](const crow::json::rvalue& body,
                                          std::vector<int>& out) {
        out.clear();
        if (!body.has("closedConnections") ||
            body["closedConnections"].t() != crow::json::type::List) {
            return;
        }
        const auto& list = body["closedConnections"];
        for (size_t i = 0; i < list.size(); ++i) {
            const auto& item = list[i];
            int id = -1;
            if (item.t() == crow::json::type::Number) {
                id = static_cast<int>(item.i());
            } else if (item.t() == crow::json::type::String) {
                try {
                    id = std::stoi(static_cast<std::string>(item.s()));
                } catch (const std::exception&) {
                    continue;
                }
            }
            if (id >= 0 && id < graph.edgeCount() &&
                std::find(out.begin(), out.end(), id) == out.end()) {
                out.push_back(id);
            }
        }
    };

    // Conexiones cerradas => grafo de trabajo por solicitud con esas aristas
    // no disponibles. El grafo compartido nunca se muta.
    auto graphForRequest = [&graph](const std::vector<int>& closed) -> mf::Graph {
        mf::Graph g = graph;
        for (const int id : closed) {
            g.setEdgeAvailable(id, false);
        }
        return g;
    };

    CROW_ROUTE(app, "/api/route").methods(crow::HTTPMethod::Post)(
        [&graph, readEndpoint, resolveId, readClosedConnections,
         graphForRequest](const crow::request& req) {
            const auto body = crow::json::load(req.body);
            if (!body) {
                return crow::response(400, "json inválido");
            }
            std::string fromStr;
            std::string toStr;
            std::string criterion = "time";
            int k = 1;
            readEndpoint(body, "from", fromStr);
            readEndpoint(body, "to", toStr);
            if (body.has("criterion") && body["criterion"].t() == crow::json::type::String) {
                criterion = static_cast<std::string>(body["criterion"].s());
            }
            if (body.has("k") && body["k"].t() == crow::json::type::Number) {
                k = static_cast<int>(body["k"].i());
            }

            if (fromStr.empty() || toStr.empty()) {
                return crow::response(400, "campos from/to obligatorios");
            }

            const int from = resolveId(fromStr);
            const int to = resolveId(toStr);
            if (from < 0 || to < 0) {
                return crow::response(400, "estación desconocida");
            }

            std::vector<int> closed;
            readClosedConnections(body, closed);
            const mf::Graph working = graphForRequest(closed);
            const mf::RoutePlanner plannerForRequest(working);

            if (k > 1) {
                const auto routes = plannerForRequest.alternatives(from, to, k);
                crow::response r(mf::jsonio::routesToJsonString(graph, routes));
                r.add_header("Content-Type", "application/json");
                return r;
            }

            mf::Route route = (criterion == "hops")
                                  ? plannerForRequest.fewestStops(from, to)
                                  : plannerForRequest.fastest(from, to);
            crow::response r(mf::jsonio::routeToJsonString(graph, route));
            r.add_header("Content-Type", "application/json");
            return r;
        });

    CROW_ROUTE(app, "/api/trace").methods(crow::HTTPMethod::Post)(
        [&graph, readEndpoint, resolveId, readClosedConnections,
         graphForRequest](const crow::request& req) {
            const auto body = crow::json::load(req.body);
            if (!body) {
                return crow::response(400, "json inválido");
            }
            std::string fromStr;
            std::string toStr;
            std::string criterion = "time";
            readEndpoint(body, "from", fromStr);
            readEndpoint(body, "to", toStr);
            if (body.has("criterion") && body["criterion"].t() == crow::json::type::String) {
                criterion = static_cast<std::string>(body["criterion"].s());
            }

            if (fromStr.empty() || toStr.empty()) {
                return crow::response(400, "campos from/to obligatorios");
            }

            const int from = resolveId(fromStr);
            const int to = resolveId(toStr);
            if (from < 0 || to < 0) {
                return crow::response(400, "estación desconocida");
            }

            std::vector<int> closed;
            readClosedConnections(body, closed);
            const mf::Graph working = graphForRequest(closed);
            const mf::RoutePlanner plannerForRequest(working);

            if (criterion == "hops") {
                const auto res = plannerForRequest.bfsTrace(from, to, true);
                crow::response r(mf::jsonio::traceToJsonString(graph, res.trace, res.stats));
                r.add_header("Content-Type", "application/json");
                return r;
            }
            const auto res = plannerForRequest.dijkstraTrace(from, to, true);
            crow::response r(mf::jsonio::traceToJsonString(graph, res.trace, res.stats));
            r.add_header("Content-Type", "application/json");
            return r;
        });

    CROW_ROUTE(app, "/api/export").methods(crow::HTTPMethod::Get)(
        [&graph]() {
            crow::response r(mf::jsonio::graphToJsonString(graph));
            r.add_header("Content-Type", "application/json");
            r.add_header("Content-Disposition", "attachment; filename=metroflow_graph.json");
            return r;
        });

    // Exporta el grafo junto con la ruta seleccionada (requisito académico).
    // Cuerpo: {from, to, criterion?, k?, index?}. Si k > 1 se incluyen las
    // rutas alternativas y `index` selecciona cuál queda como ruta principal.
    CROW_ROUTE(app, "/api/export").methods(crow::HTTPMethod::Post)(
        [&graph, readEndpoint, resolveId, readClosedConnections,
         graphForRequest](const crow::request& req) {
            const auto body = crow::json::load(req.body);
            if (!body) {
                return crow::response(400, "json inválido");
            }
            std::string fromStr;
            std::string toStr;
            std::string criterion = "time";
            readEndpoint(body, "from", fromStr);
            readEndpoint(body, "to", toStr);
            if (body.has("criterion") &&
                body["criterion"].t() == crow::json::type::String) {
                criterion = static_cast<std::string>(body["criterion"].s());
            }
            int k = 1;
            int index = 0;
            if (body.has("k") && body["k"].t() == crow::json::type::Number) {
                k = static_cast<int>(body["k"].i());
            }
            if (body.has("index") && body["index"].t() == crow::json::type::Number) {
                index = static_cast<int>(body["index"].i());
            }

            if (fromStr.empty() || toStr.empty()) {
                return crow::response(400, "campos from/to obligatorios");
            }
            const int from = resolveId(fromStr);
            const int to = resolveId(toStr);
            if (from < 0 || to < 0) {
                return crow::response(400, "estación desconocida");
            }

            std::vector<int> closed;
            readClosedConnections(body, closed);
            const mf::Graph working = graphForRequest(closed);
            const mf::RoutePlanner plannerForRequest(working);

            std::vector<mf::Route> alternatives;
            mf::Route route;
            if (k > 1) {
                alternatives = plannerForRequest.alternatives(from, to, k);
            }
            if (!alternatives.empty()) {
                if (index < 0 || index >= static_cast<int>(alternatives.size())) {
                    index = 0;
                }
                route = alternatives[static_cast<size_t>(index)];
            } else {
                route = (criterion == "hops")
                            ? plannerForRequest.fewestStops(from, to)
                            : plannerForRequest.fastest(from, to);
            }

            crow::response r(mf::jsonio::exportToJsonString(
                graph, route, alternatives, graph.station(from).name,
                graph.station(to).name, criterion, closed));
            r.add_header("Content-Type", "application/json");
            r.add_header("Content-Disposition",
                         "attachment; filename=metroflow_route.json");
            return r;
        });

    if (fs::exists(distDir)) {
        app.loglevel(crow::LogLevel::Warning);
        CROW_LOG_WARNING << "Serving static dir: " << distDir;

        auto mimeFor = [](const std::string& ext) -> std::string {
            if (ext == ".html") return "text/html; charset=utf-8";
            if (ext == ".js" || ext == ".mjs") return "text/javascript; charset=utf-8";
            if (ext == ".css") return "text/css; charset=utf-8";
            if (ext == ".json") return "application/json; charset=utf-8";
            if (ext == ".svg") return "image/svg+xml";
            if (ext == ".png") return "image/png";
            if (ext == ".jpg" || ext == ".jpeg") return "image/jpeg";
            if (ext == ".ico") return "image/x-icon";
            if (ext == ".woff2") return "font/woff2";
            if (ext == ".map") return "application/json; charset=utf-8";
            return "application/octet-stream";
        };

        auto sendFile = [&](crow::response& res, const fs::path& filePath) {
            std::ifstream file(filePath, std::ios::binary);
            if (!file) return false;
            std::string content((std::istreambuf_iterator<char>(file)),
                                std::istreambuf_iterator<char>());
            res.set_header("Content-Type", mimeFor(filePath.extension().string()));
            res.write(content);
            res.end();
            return true;
        };

        auto serveStatic = [&distDir, sendFile](crow::response& res, std::string path) {
            if (path.rfind("api/", 0) == 0) {
                res.code = 404;
                res.end();
                return;
            }
            fs::path base = fs::weakly_canonical(distDir);
            fs::path target = base / path;
            if (!path.empty() && fs::exists(target) && !fs::is_directory(target)) {
                fs::path canon = fs::weakly_canonical(target);
                if (canon.string().rfind(base.string(), 0) == 0 && sendFile(res, canon)) {
                    return;
                }
            }
            // SPA fallback
            if (!sendFile(res, base / "index.html")) {
                res.code = 404;
                res.write("Not found");
                res.end();
            }
        };

        app.route_dynamic("/")([serveStatic](const crow::request&, crow::response& res) {
            serveStatic(res, "");
        });

        app.route_dynamic("/<path>")(
            [serveStatic](const crow::request&, crow::response& res, std::string path) {
                serveStatic(res, path);
            });
    }

    app.port(readPortFromEnv()).multithreaded().run();
    return 0;
}
