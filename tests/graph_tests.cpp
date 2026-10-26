#include "doctest.h"

#include <stdexcept>

#include "Graph.hpp"

using namespace mf;

namespace {

Graph makeSmallGraph() {
    Graph graph;
    Station a;
    a.name = "A";
    a.lines = {"L1"};
    Station b;
    b.name = "B";
    b.lines = {"L1"};
    Station c;
    c.name = "C";
    c.lines = {"L2"};
    graph.addStation(a);
    graph.addStation(b);
    graph.addStation(c);
    return graph;
}

}  // namespace

TEST_CASE("addStation asigna ids secuenciales y registra nombres") {
    Graph graph = makeSmallGraph();
    CHECK(graph.stationCount() == 3);
    CHECK(graph.station(0).name == "A");
    CHECK(graph.station(2).name == "C");
    CHECK(graph.idOf("B") == 1);
    CHECK(graph.hasStation("C"));
    CHECK_FALSE(graph.hasStation("Z"));
}

TEST_CASE("idOf lanza para estaciones desconocidas") {
    Graph graph = makeSmallGraph();
    CHECK_THROWS_AS(graph.idOf("NoExiste"), std::out_of_range);
}

TEST_CASE("addEdge construye la lista de adyacencia por índices") {
    Graph graph = makeSmallGraph();
    Edge edge;
    edge.from = 0;
    edge.to = 1;
    edge.line = "L1";
    edge.timeMin = 2.0;
    graph.addEdge(edge);

    CHECK(graph.edgeCount() == 1);
    CHECK(graph.outEdges(0).size() == 1);
    CHECK(graph.outEdges(1).empty());
    CHECK(graph.edge(graph.outEdges(0).front()).to == 1);
}

TEST_CASE("addEdge valida el rango de las estaciones") {
    Graph graph = makeSmallGraph();
    Edge edge;
    edge.from = 0;
    edge.to = 99;
    edge.line = "L1";
    edge.timeMin = 1.0;
    CHECK_THROWS_AS(graph.addEdge(edge), std::out_of_range);
}

TEST_CASE("lines devuelve las líneas presentes, ordenadas y sin repetir") {
    Graph graph = makeSmallGraph();
    Edge e1;
    e1.from = 0;
    e1.to = 1;
    e1.line = "L1";
    Edge e2;
    e2.from = 1;
    e2.to = 2;
    e2.line = "L2";
    graph.addEdge(e1);
    graph.addEdge(e2);
    const auto lines = graph.lines();
    REQUIRE(lines.size() == 2);
    CHECK(lines[0] == "L1");
    CHECK(lines[1] == "L2");
}
