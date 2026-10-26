#pragma once

#include <string>
#include <vector>

namespace mf {

// Una estación física del sistema. Puede pertenecer a varias líneas
// (por ejemplo, San Antonio pertenece a la línea A y a la línea B); NO se
// duplica la estación por cada línea para no fragmentar la red.
struct Station {
    int id = -1;
    std::string name;
    std::vector<std::string> lines;
    double lat = 0.0;
    double lng = 0.0;
    std::string municipio;
    std::string position;  // "elevada", "a nivel", "soterrada"
    bool terminal = false;
    std::vector<std::string> interchanges;
};

}  // namespace mf
