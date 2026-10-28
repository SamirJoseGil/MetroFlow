# Dockerfile para MetroFlow API (Linux)
# Compila con g++ + Crow/ASIO
# Listo para Render/Railway/Fly.io

FROM ubuntu:22.04 AS builder

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y \
    build-essential \
    g++ \
    make \
    pkg-config \
    git \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copiar todo el proyecto
COPY . .

# Compilar API para Linux
RUN mkdir -p build && \
    g++ -std=c++17 -O2 -Wall -Wextra \
        -Ibackend/include -Ibackend/third_party -Ibackend/third_party/crow -Ibackend/third_party/asio/include \
        backend/src/Graph.cpp \
        backend/src/Dijkstra.cpp \
        backend/src/Bfs.cpp \
        backend/src/RoutePlanner.cpp \
        backend/src/DataLoader.cpp \
        backend/src/Serialize.cpp \
        backend/src/api_main.cpp \
        -lpthread \
        -o build/metroflow_api

# Runtime stage
FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copiar binario
COPY --from=builder /app/build/metroflow_api ./metroflow_api

# Copiar datos necesarios
COPY data ./data

# Copiar frontend/dist si existe (para servir estáticos)
COPY frontend/dist ./frontend/dist 2>/dev/null || mkdir -p ./frontend/dist

# Permisos
RUN chmod +x ./metroflow_api

# Puerto por defecto
ENV PORT=8080
ENV HOST=0.0.0.0

EXPOSE 8080

# Ejecutar
CMD ["./metroflow_api"]
