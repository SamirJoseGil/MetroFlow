# Dockerfile — MetroFlow (API C++ + frontend servido)
# Build multi-stage:
#   1. frontend:  Node + Vite -> frontend/dist
#   2. builder:   g++ -> compilación del binario metroflow_api
#   3. runtime:   imagen mínima con el binario, data/ y frontend/dist
#
# Construir:   docker build -t metroflow-api:latest .
# Ejecutar:    docker run --rm -p 8080:8080 -e PORT=8080 metroflow-api:latest
# Probar:      curl http://localhost:8080/api/health

# ================= STAGE 1: Frontend (Vite) =================
FROM node:24-alpine AS frontend

WORKDIR /app/frontend

# Dependencias primero (capa de cache)
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

# Código y build de producción
COPY frontend/ .
RUN npm run build

# ================= STAGE 2: Backend builder (g++) =================
FROM ubuntu:22.04 AS builder

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y \
    build-essential \
    g++ \
    make \
    pkg-config \
    git \
    curl \
    ca-certificates \
    tar \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY backend ./backend
COPY data ./data

# ------------------------------------------------------------
# Restaurar dependencias de terceros que no vienen en el repo:
#   - ASIO standalone (header-only, provee <asio.hpp>)
# El directorio backend/third_party/asio esta vacio (sin submódulo
# configurado), por lo que se descarga una version conocida y
# consistente en el build. El crow.h del repositorio ya es el
# amalgamado completo (incluye CORSHandler), por lo que no hace
# falta descargar crow por separado.
# ------------------------------------------------------------
RUN set -e; \
    mkdir -p /tmp/deps; \
    # ASIO standalone (header-only, provee <asio.hpp>, <asio/version.hpp>, <asio/ssl.hpp>)
    # El tarball de asio 1.28+ tiene los headers bajo asio/include/; se copian a
    # backend/third_party/asio/include/ para que -I backend/third_party/asio/include
    # resuelva <asio.hpp> y <asio/version.hpp>.
    curl -fsSL https://github.com/chriskohlhoff/asio/archive/refs/tags/asio-1-28-0.tar.gz \
        | tar xz -C /tmp/deps --strip-components=1; \
    mkdir -p backend/third_party/asio/include; \
    cp -r /tmp/deps/asio/include/. backend/third_party/asio/include/; \
    rm -rf /tmp/deps

# Compilar API para Linux (mismo conjunto de fuentes que build.ps1 -Api)
RUN mkdir -p build && \
    g++ -std=c++17 -O2 -Wall -Wextra \
        -Ibackend/include -Ibackend/third_party -Ibackend/third_party/asio/include \
        backend/src/Graph.cpp \
        backend/src/Dijkstra.cpp \
        backend/src/Bfs.cpp \
        backend/src/RoutePlanner.cpp \
        backend/src/DataLoader.cpp \
        backend/src/Serialize.cpp \
        backend/src/api_main.cpp \
        -lpthread \
        -o build/metroflow_api

# ================= STAGE 3: Runtime =================
FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y \
    ca-certificates \
    libstdc++6 \
    libgcc-s1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Puerto publicado por los proveedores (Render/Railway/Fly) y local
ENV PORT=8080
ENV HOST=0.0.0.0

EXPOSE 8080

# Binario compilado
COPY --from=builder /app/build/metroflow_api ./metroflow_api
# Datos de la red (estaciones y conexiones)
COPY --from=builder /app/data ./data
# Frontend compilado (servido por la API en modo monolítico)
COPY --from=frontend /app/frontend/dist ./frontend/dist

RUN chmod +x ./metroflow_api

CMD ["./metroflow_api"]
