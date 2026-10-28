# Dockerización y Despliegue de MetroFlow API

Este documento explica cómo crear la imagen Docker, probarla localmente y desplegar el **backend** (API C++) en un servicio gratuito para usarlo desde **Vercel** (frontend).

## 1) Archivos creados

Ya se han añadido estos archivos al repositorio:

| Archivo | Propósito |
|---|---|
| `Dockerfile` | Imagen multi-stage: construye el frontend con Node/Vite, compila la API C++ con g++ (Crow/ASIO/nlohmann) y une todo en un runtime Ubuntu 22.04 mínimo. |
| `.dockerignore` | Optimiza el contexto de build excluyendo `node_modules`, `.git`, builds locales, etc. |
| `docker-compose.yml` | Levanta la API localmente con un solo comando (`docker compose up --build`). |
| `render.yaml` | Blueprint para desplegar con [Render](https://render.com/) directamente desde el repo. |
| `railway.json` | Config para [Railway](https://railway.app/). |
| `fly.toml` | Config para [Fly.io](https://fly.io/). |
| `backend/src/api_main.cpp` | CORS con `crow::CORSHandler` y lectura del puerto desde la variable de entorno `PORT` (default `18080` local, `8080` en Docker). |

## 2) Preparar variables y CORS

### Backend
El middleware CORS está configurado globalmente en `backend/src/api_main.cpp`:

```cpp
crow::App<crow::CORSHandler> app;

auto& cors = app.get_middleware<crow::CORSHandler>();
cors.global()
    .origin("*")
    .methods("GET"_method, "POST"_method, "OPTIONS"_method)
    .headers("Content-Type", "Authorization", "X-Requested-With")
    .allow_credentials();
```

El puerto se lee de la variable de entorno `PORT`; si no está definida, usa `18080`. En el contenedor Docker el valor por defecto es `8080`.

Si en producción **solo** quieres permitir tu dominio de Vercel, cambia `.origin("*")` por `.origin("https://TU-PROYECTO.vercel.app")` antes de construir la imagen.

### Frontend (Vercel)
En tu proyecto de Vercel añade esta variable de entorno:

```env
VITE_API_BASE_URL=https://TU-BACKEND-URL
```

> Sin `/` al final. Ejemplo: `https://metroflow-api.onrender.com`

Si se deja vacía, el frontend seguirá funcionando cuando el backend sirva `frontend/dist` junto al API (modo monolítico, que es lo que hace el `Dockerfile`).

## 3) Construir y probar la imagen (local)

Este equipo **sí tiene Docker Engine**, así que puedes construir y probar la imagen localmente desde la **raíz del proyecto**:

```bash
# Construir imagen
docker build -t metroflow-api:latest .

# Probar localmente (verificar puerto)
docker run --rm -p 8080:8080 -e PORT=8080 metroflow-api:latest
```

O con Docker Compose (recomendado):

```bash
docker compose up --build
```

Comprobar:
```bash
curl http://localhost:8080/api/health
# {"status":"ok"}

curl http://localhost:8080/api/stations | head -c 120
# {"lines":["A","B",...],"stationCount":57,...}
```

El frontend también se sirve desde la API: `http://localhost:8080/`.

## 4) Subir a un registro (opcional pero útil)

Si vas a build by hand:

```bash
# Docker Hub
docker tag metroflow-api:latest TU_USUARIO/metroflow-api:latest
docker login
docker push TU_USUARIO/metroflow-api:latest

# GHCR
docker tag metroflow-api:latest ghcr.io/TU_USUARIO/metroflow-api:latest
docker login ghcr.io
docker push ghcr.io/TU_USUARIO/metroflow-api:latest
```

## 5) Desplegar en servicios gratuitos

### A) Render.com (Recomendado - fácil y gratis)
1. Sube el repo a GitHub/GitLab
2. Ve a [dashboard.render.com](https://dashboard.render.com/) → `New +` → `Blueprint`
3. Conecta tu repo. Render detectará `render.yaml`
4. Pulsa `Apply`. Construirá con `Dockerfile` y desplegará
5. Copia la URL que te salga: `https://xxxx.onrender.com`

> Render free tier se duerme tras inactividad. Primera petición tras dormir puede tardar 30-60s (cold start).

### B) Railway.app (Rápido, moderno)
1. Sube el repo a GitHub
2. [railway.app](https://railway.app/) → `New Project` → `Deploy from GitHub repo`
3. Selecciona el repo. Railway detectará `Dockerfile`/`railway.json`
4. Al terminar te dará una URL pública
5. Puedes añadir variables `PORT`, `HOST` si lo deseas (Railway asigna `PORT` automáticamente, pero el `Dockerfile` ya lee env)

### C) Fly.io (Siempre activo en free tier)
1. Instalar [flyctl](https://fly.io/docs/hands-on/install-flyctl/)
2. Autenticarse: `fly auth login`
3. Desde **raíz del repo**:
   ```bash
   fly launch --no-deploy
   # acepta app name, region, etc.
   fly deploy
   ```
4. `fly status` / `fly open` / URL pública
5. Revisa logs: `fly logs`

## 6) Conectar Vercel con el backend
1. Ve a tu proyecto en [vercel.com](https://vercel.com/)
2. `Settings` → `Environment Variables`
3. Añade:
   - Key: `VITE_API_BASE_URL`
   - Value: `https://TU-BACKEND-URL`
   - Environments: Production (y Preview si quieres)
4. Redeploya el frontend

Con eso, desde `*.vercel.app` las peticiones `/api/*` irán a tu backend separado con CORS habilitado.

## 7) Verificación rápida
Tras desplegar el backend:

```bash
curl https://TU-BACKEND-URL/api/health
# {"status":"ok"}
```

Desde el frontend desplegado en Vercel debería cargar estaciones, grafo, rutas y trazas correctamente.

## 8) Notas importantes
- **Puerto:** Render/Railway/Fly inyectan `PORT` dinámicamente. El `Dockerfile` expone `8080` y el `api_main.cpp` lee `PORT` del entorno (default `8080` en contenedor, `18080` si corres el binario sin Docker).
- **Archivos necesarios:** `data/` está incluido en el `Dockerfile`. El frontend compilado (`frontend/dist`) se genera en el propio build de Docker, por lo que no hace falta buildéarlo fuera.
- **Dependencias de terceros:** `backend/third_party/asio` y `backend/third_party/crow` están vacíos en el repositorio (sin submódulos configurados). El `Dockerfile` descarga ASIO standalone en el build y usa el `crow.h` amalgamado que ya incluye el repositorio (que incorpora `CORSHandler`).
- **CORS:** Si limitas a un solo dominio, modifica `backend/src/api_main.cpp` antes de construir la imagen.
- **Sin Docker Desktop:** Este entorno usa Docker Engine nativo de Linux, no Docker Desktop.

**Todo listo para construir la imagen, probarla localmente, subirla y configurar Vercel.**
