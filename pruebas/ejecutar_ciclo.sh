#!/usr/bin/env bash
# Ejecuta un ciclo completo de pruebas de seguridad y calidad sobre Atlas.
#
#   pruebas/ejecutar_ciclo.sh <ciclo> <version> <carpeta_salida>
#
# Requiere: Docker, Python 3, Node.js 20+ y la aplicación levantada con docker compose.
# Variables opcionales: API_URL, FRONT_URL, HTTP_FRONT_URL, API_URL_DOCKER, FRONT_URL_DOCKER,
#                       OPENAPI_URL_DOCKER, SECRETOS_DIR, INSECURE_TLS, OMITIR (lista: k6,zap,lighthouse,...)
set -u
CICLO="${1:?ciclo}"; VERSION="${2:?version}"; OUT="${3:?carpeta de salida}"
RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$OUT"; OUT="$(cd "$OUT" && pwd)"
export MSYS_NO_PATHCONV=1
win() { if command -v cygpath >/dev/null; then cygpath -m "$1"; else echo "$1"; fi; }
# En Windows (Git Bash) se usan rutas C:/... que entienden bash, Python, Node y Docker
RAIZ="$(win "$RAIZ")"; OUT="$(win "$OUT")"

API_URL="${API_URL:-http://localhost:4450}"
FRONT_URL="${FRONT_URL:-http://localhost:3350}"
HTTP_FRONT_URL="${HTTP_FRONT_URL:-http://localhost:3350}"
API_URL_DOCKER="${API_URL_DOCKER:-http://host.docker.internal:4450}"
FRONT_URL_DOCKER="${FRONT_URL_DOCKER:-http://host.docker.internal:3350}"
OPENAPI_URL_DOCKER="${OPENAPI_URL_DOCKER:-$API_URL_DOCKER/openapi.json}"
SECRETOS_DIR="${SECRETOS_DIR:-$RAIZ}"
OMITIR="${OMITIR:-}"
omitido() { [[ ",$OMITIR," == *",$1,"* ]]; }
log() { echo; echo "=== [$(date '+%d-%m-%Y %H:%M:%S')] $*"; }
export API_URL FRONT_URL HTTP_FRONT_URL CICLO VERSION_SUT="$VERSION"

{
echo "Ciclo: $CICLO · Versión: $VERSION · Inicio: $(date '+%d-%m-%Y %H:%M:%S')"
echo "Commit: $(git -C "$RAIZ" rev-parse --short HEAD 2>/dev/null) · API: $API_URL · Frontend: $FRONT_URL"
} > "$OUT/ejecucion.txt"

# ---------------------------------------------------------------- 1. SCA: npm audit
if ! omitido npm; then
  log "SCA · npm audit"
  mkdir -p "$OUT/sca"
  for d in BACKEND FRONTEND; do
    (cd "$RAIZ/$d" && npm audit --package-lock-only --json > "$OUT/sca/npm_audit_${d,,}.json" 2>/dev/null)
    node -e "const a=require(process.argv[1]).metadata.vulnerabilities;console.log('$d',JSON.stringify(a))" "$OUT/sca/npm_audit_${d,,}.json" | tee -a "$OUT/sca/resumen.txt"
  done
fi

# ---------------------------------------------------------------- 2. SAST: Semgrep
if ! omitido semgrep; then
  log "SAST · Semgrep"
  mkdir -p "$OUT/sast"
  docker run --rm -v "$(win "$RAIZ"):/src" -w /src semgrep/semgrep:latest semgrep scan \
    --config p/javascript --config p/nodejs --config p/react --config p/secrets --config p/dockerfile \
    --config p/owasp-top-ten --config p/jwt --metrics off \
    --exclude node_modules --exclude pruebas --exclude dist --exclude "*.sql" \
    --json --output /src/.semgrep_salida.json > "$OUT/sast/semgrep_consola.txt" 2>&1
  mv "$RAIZ/.semgrep_salida.json" "$OUT/sast/semgrep.json" 2>/dev/null
  python -X utf8 -c "import json,sys,collections;d=json.load(open(sys.argv[1],encoding='utf-8'));r=d['results'];c=collections.Counter(x['extra']['severity'] for x in r);print('Semgrep hallazgos:',len(r),dict(c))" "$OUT/sast/semgrep.json" | tee "$OUT/sast/resumen.txt"
fi

# ---------------------------------------------------------------- 3. Secretos: Gitleaks
if ! omitido gitleaks; then
  log "Secretos · Gitleaks ($SECRETOS_DIR)"
  mkdir -p "$OUT/secretos"
  docker run --rm -v "$(win "$SECRETOS_DIR"):/src" -v "$(win "$OUT/secretos"):/out" zricethezav/gitleaks:latest \
    dir /src --redact --no-banner --report-format json --report-path /out/gitleaks_archivos.json > "$OUT/secretos/gitleaks_consola.txt" 2>&1
  if [ -d "$RAIZ/.git" ]; then
    docker run --rm -v "$(win "$RAIZ"):/src" -v "$(win "$OUT/secretos"):/out" zricethezav/gitleaks:latest \
      git /src --redact --no-banner --report-format json --report-path /out/gitleaks_historial.json >> "$OUT/secretos/gitleaks_consola.txt" 2>&1
  fi
  tail -n 4 "$OUT/secretos/gitleaks_consola.txt"
fi

# ---------------------------------------------------------------- 4. Contenedores: Trivy
if ! omitido trivy; then
  log "Contenedores · Trivy"
  mkdir -p "$OUT/contenedores"
  for img in atlas-atlas-backend atlas-atlas-frontend; do
    docker run --rm -v //var/run/docker.sock:/var/run/docker.sock -v trivy-cache:/root/.cache/ aquasec/trivy:latest \
      image --quiet --scanners vuln --severity CRITICAL,HIGH,MEDIUM --format json "$img:latest" > "$OUT/contenedores/trivy_${img#atlas-atlas-}.json" 2>/dev/null
  done
  docker run --rm -v "$(win "$RAIZ"):/src" -v trivy-cache:/root/.cache/ aquasec/trivy:latest \
    config --quiet --format json /src > "$OUT/contenedores/trivy_config.json" 2>/dev/null
  python -X utf8 "$RAIZ/pruebas/resumir_trivy.py" "$OUT/contenedores" | tee "$OUT/contenedores/resumen.txt"
fi

# ---------------------------------------------------------------- 5. Pruebas de API (funcionales y de seguridad)
if ! omitido api; then
  log "Pruebas de API · atlas_seguridad.py"
  OUT_DIR="$OUT/api" PYTHONIOENCODING=utf-8 python -X utf8 "$RAIZ/pruebas/api/atlas_seguridad.py" | tee "$OUT/api_consola.txt"
fi

# ---------------------------------------------------------------- 6. Pruebas de interfaz (Playwright + axe)
if ! omitido e2e; then
  log "Pruebas de interfaz · Playwright + axe-core"
  (cd "$RAIZ/pruebas" && OUT_DIR="$OUT/e2e" node e2e/atlas_e2e.mjs) | tee "$OUT/e2e_consola.txt"
fi

# ---------------------------------------------------------------- 7. Rendimiento de carga de página: Lighthouse (CP-17)
if ! omitido lighthouse; then
  log "Rendimiento de página · Lighthouse (perfil móvil, 3 corridas)"
  mkdir -p "$OUT/lighthouse"
  CHROME_PATH="$(cd "$RAIZ/pruebas" && node -e "import('playwright').then(p=>console.log(p.chromium.executablePath()))")"
  export CHROME_PATH
  for i in 1 2 3; do
    (cd "$RAIZ/pruebas" && node node_modules/lighthouse/cli/index.js "$FRONT_URL/login" --quiet \
      --chrome-flags="--headless=new --ignore-certificate-errors --no-sandbox" --only-categories=performance,accessibility,best-practices \
      --output json --output html --output-path "$OUT/lighthouse/corrida_$i")
  done
  python -X utf8 "$RAIZ/pruebas/resumir_lighthouse.py" "$OUT/lighthouse" | tee "$OUT/lighthouse/resumen.txt"
fi

# ---------------------------------------------------------------- 8. Carga y concurrencia: k6 (CP-05 y CP-18)
if ! omitido k6; then
  log "Carga · k6 (10 usuarios 1 min + 200 usuarios 5 min)"
  mkdir -p "$OUT/k6"
  docker run --rm -v "$(win "$RAIZ/pruebas/k6"):/scripts:ro" -v "$(win "$OUT/k6"):/salida" \
    -e API_URL="$API_URL_DOCKER" grafana/k6:latest run --quiet /scripts/carga_atlas.js > "$OUT/k6/k6_consola.txt" 2>&1
  tail -n 15 "$OUT/k6/k6_consola.txt"
fi

# ---------------------------------------------------------------- 9. DAST: OWASP ZAP (al final: el escaneo activo crea datos)
if ! omitido zap; then
  log "DAST · OWASP ZAP (baseline del frontend y escaneo de la API con OpenAPI)"
  mkdir -p "$OUT/zap"; chmod 777 "$OUT/zap" 2>/dev/null
  docker run --rm -v "$(win "$OUT/zap"):/zap/wrk:rw" zaproxy/zap-stable:latest zap-baseline.py \
    -t "$FRONT_URL_DOCKER" -r zap_frontend.html -J zap_frontend.json -I > "$OUT/zap/zap_frontend_consola.txt" 2>&1
  docker run --rm -v "$(win "$OUT/zap"):/zap/wrk:rw" zaproxy/zap-stable:latest zap-api-scan.py \
    -t "$OPENAPI_URL_DOCKER" -f openapi -O "$API_URL_DOCKER" -r zap_api.html -J zap_api.json -I > "$OUT/zap/zap_api_consola.txt" 2>&1
  python -X utf8 "$RAIZ/pruebas/resumir_zap.py" "$OUT/zap" | tee "$OUT/zap/resumen.txt"
fi

echo "Fin: $(date '+%d-%m-%Y %H:%M:%S')" >> "$OUT/ejecucion.txt"
log "Ciclo $CICLO terminado · resultados en $OUT"
