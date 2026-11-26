# Sistema de Gestión Atlas

Proyecto de la asignatura ISY1102 - Seguridad y calidad en el desarrollo de software (Caso A).
Atlas permite a pequeñas y medianas empresas gestionar clientes, contratos y documentos, administrar
usuarios y roles, y auditar las acciones críticas, con especial atención a la usabilidad para adultos
mayores y al cumplimiento de las leyes N.° 19.628 y N.° 21.719.

Esta rama contiene la **versión 2.0**, que corrige los 23 defectos detectados en el Ciclo 1 de pruebas
(ver `CHANGELOG.md` y `SECURITY.md`). La versión original del docente está en la etiqueta `v1.0`.

## Estructura

```
BACKEND/            API REST (Node.js 22 + Express + PostgreSQL)
  src/              código (middleware/, routes/, seguridad/)
  sql/migraciones/  migraciones versionadas (se aplican en orden)
  test/             pruebas unitarias (node:test)
FRONTEND/           aplicación React (Vite) servida por nginx con TLS
pruebas/            pruebas de seguridad y calidad (API, interfaz, carga, Semgrep)
scripts/            generación de secretos y certificados
.github/workflows/  pipeline de controles de seguridad automatizados
docker-compose.yml  base, migraciones, API y frontend
```

## Puesta en marcha con Docker

1. Generar el archivo `.env` con secretos aleatorios (no se versiona):
   ```bash
   scripts/generar_env.sh
   ```
   Variables: `POSTGRES_PASSWORD`, `APP_DB_PASSWORD`, `JWT_SECRET` (32+ caracteres) y
   `DATA_ENCRYPTION_KEY` (32 bytes en base64). Ver `.env.example`. Si falta alguna, los servicios no inician.
2. Generar el certificado TLS del laboratorio (autofirmado; en producción, uno emitido por una autoridad):
   ```bash
   scripts/generar_certificados.sh
   ```
3. Levantar los servicios:
   ```bash
   docker compose up -d --build
   ```
4. Abrir **https://localhost:3443** (el puerto 3350 solo redirige a HTTPS). La API se publica en el mismo
   origen, en `https://localhost:3443/api`. PostgreSQL escucha solo en `127.0.0.1:15432`.

Credenciales del dump de ejemplo: `admin` (administrador) y `editor` (solo lectura). Son cuentas de
laboratorio; en un ambiente real deben eliminarse o cambiarse antes del primer uso.

## Pruebas

```bash
cd BACKEND && npm test                 # pruebas unitarias de los controles de seguridad
bash pruebas/ejecutar_ciclo.sh 2 v2.0 salida/ciclo2   # ciclo completo (requiere la aplicación levantada)
```

El ciclo completo ejecuta npm audit, Semgrep (reglas de la comunidad y reglas propias), Gitleaks, Trivy,
la suite de API (`pruebas/api/atlas_seguridad.py`), Playwright con axe-core, Lighthouse, k6 y OWASP ZAP.
Para la versión con HTTPS:

```bash
API_URL=https://localhost:3443/api FRONT_URL=https://localhost:3443 HTTP_FRONT_URL=http://localhost:3350 \
INSECURE_TLS=1 API_URL_DOCKER=https://host.docker.internal:3443/api FRONT_URL_DOCKER=https://host.docker.internal:3443 \
OPENAPI_ARCHIVO=BACKEND/src/openapi.json bash pruebas/ejecutar_ciclo.sh 2 v2.0 salida/ciclo2
```

## Seguridad

Ver `SECURITY.md` para los controles implementados, la configuración segura y cómo reportar
vulnerabilidades.
