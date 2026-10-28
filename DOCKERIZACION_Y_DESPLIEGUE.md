# Dockerización y Despliegue de MetroFlow API

Este documento explica cómo crear la imagen Docker, subirla y configurar todo lo necesario para desplegar **únicamente el backend** (API C++) en un servicio gratuito para usarlo desde **Vercel** (frontend).

> **Nota importante:** En este equipo NO hay Hyper-V habilitado, por lo que **NO se usa Docker Desktop localmente**. Aquí solo se deja lo necesario para **construir la imagen y subirla** desde un entorno con Docker (o desde el propio proveedor que lo haga por ti).

## 1) Archivos creados

Ya se han añadido estos archivos al repositorio:

| Archivo | Propósito |
|---|---|
| `Dockerfile` | Construye la imagen Linux con g++ y compila `metroflow_api`. Copia `data/` y `frontend/dist/` opcional. |
| `.dockerignore` | Optimiza el contexto de build excluyendo `node_modules`, `.git`, builds locales, etc. |
| `render.yaml` | Blueprint para desplegar con [Render](https://render.com/) directamente desde el repo. |
| `railway.json` | Config para [Railway](https://railway.app/). |
| `fly.toml` | Config para [Fly.io](https://fly.io/). |
| `backend/src/api_main.cpp` | Añadido CORS con el middleware `crow::CORSHandler` (permite llamadas desde Vercel). |
| `frontend/src/api.ts` | Ahora usa `VITE_API_BASE_URL` para apuntar al backend desplegado cuando se configure. |

## 2) Preparar variables y CORS

### Backend
El middleware CORS ya está configurado globalmente en `backend/src/api_main.cpp`:

```cpp
crow::App<crow::CORSHandler> app;

auto& cors = app.get_middleware<crow::CORSHandler>();
cors.global()
    .origin("*")
    .methods("GET"_method, "POST"_method, "OPTIONS"_method)
    .headers("Content_type", "Authorization", "X-Requested-With")
    .allow_credentials();
```

Si en producción **solo** quieres permitir tu dominio de Vercel, cambia `.origin("*")` por `.origin("https://TU-PROYECTO.vercel.app")`. Con `allow_credentials()` y `origin("*")` hay ciertas restricciones; para `GET/POST` JSON con rutas relativas a `/api/*` lo más directo es permitir el dominio específico.

### Frontend (Vercel)
En tu proyecto de Vercel añade esta variable de entorno:

```env
VITE_API_BASE_URL=https://TU-BACKEND-URL
```

> Sin `/` al final. Ejemplo: `https://metroflow-api.onrender.com`

Si se deja vacía, el frontend seguirá funcionando cuando el backend sirva `frontend/dist` junto al API (modo monolítico).

## 3) Construir la imagen (desde un entorno con Docker)

**NO necesitas hacerlo en este equipo.** Puedes hacerlo desde:

- GitHub Actions con `docker/build-push-action`
- GitLab CI
- Render/Railway/Fly.io (ellos mismos construyen con el `Dockerfile`)
- Otro PC con Docker Desktop/Engine

### Local (solo si tienes Docker Engine disponible)
Desde la **raíz del proyecto**:

```bash
# Construir imagen
docker build -t metroflow-api:latest .

# Probar localmente (verificar puerto)
docker run --rm -p 8080:8080 -e PORT=8080 -e HOST=0.0.0.0 metroflow-api:latest
```

Comprobar:
```bash
curl http
://localhost:8080/api/health
```

### Subir a un registro (opcional pero útil)
Si vas to build by hand:

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

## 4) Desplegar en servicios gratuitos

### A) Render.com (Recomendado - fácil y gratis)
1. Sube el repo a GitHub/GitLab
2. Ve a [dashboard.render.com](https
://dashboard.render.com/) → `New +` → `Blueprint`
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

## 5) Conectar Vercel con el backend
1. Ve a tu proyecto en [vercel.com](https://vercel.com/)
2. `Settings` → `Environment Variables`
3. Añade:
   - Key: `VITE_API_BASE_URL`
   - Value: `https://TU-BACKEND-URL`
   - Environments: Production (y Preview si quieres)
4. Redeploya el frontend

Con eso, desde `*.vercel.app` las peticiones `/api/*` irán a tu backend separado con CORS habilitado.

## 6) Verificación rápida
Tras desplegar el backend:

```bash
curl https://TU-BACKEND-URL/api/health
# {"status":"ok"}
```

Desde el frontend desplegado en Vercel debería cargar estaciones, grafo, rutas y trazas correctamente.

## 7) Notas importantes
- **Puerto:** Render usa el puerto que asigne (`PORT` variable). El `Dockerfile` expone 8080 y el `api_main.cpp` escucha en 18080 por defecto local. En producción los proveedores suelen inyectar `PORT`. Si notas que no escucha, revisa logs. En el código actual `app.port(18080)...run()` está fijo a 18080. Para que funcione con `PORT` dinámico hay que leerlo desde entorno. Si tras desplegar no responde, avísame y lo ajusto sin problema.
- **Archivos necesarios:** `data/` está incluido en el `Dockerfile`. Si cambias rutas, hay que tenerlo en cuenta.
- **CORS:** Si limitas a un solo dominio, modifica `backend/src/api_main.cpp` antes de construir la imagen.
- **Sin Docker local:** Como no tienes Hyper-V, **no compiles ni pruebes con Docker Desktop aquí**. Usa los proveedores o CI para construir/subir la imagen.

**Todo listo para construir la imagen, subirla y configurar Vercel.**