#!/usr/bin/env bash
# Análisis estático con SonarQube Community (Docker) y exportación de resultados.
#   pruebas/sonar.sh <clave_proyecto> <carpeta_salida>
# La contraseña del administrador local de SonarQube se toma de SONAR_ADMIN_PASS
# (solo para el servidor de laboratorio; no se registra en el informe).
set -u
CLAVE="${1:?clave del proyecto}"; OUT="${2:?carpeta de salida}"
RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$OUT"; OUT="$(cd "$OUT" && pwd)"
export MSYS_NO_PATHCONV=1
win() { if command -v cygpath >/dev/null; then cygpath -m "$1"; else echo "$1"; fi; }
RAIZ="$(win "$RAIZ")"; OUT="$(win "$OUT")"
SQ=http://localhost:9000
PASS="${SONAR_ADMIN_PASS:?definir SONAR_ADMIN_PASS}"

if ! docker ps --format '{{.Names}}' | grep -q '^atlas-sonarqube$'; then
  docker run -d --name atlas-sonarqube -p 127.0.0.1:9000:9000 -e SONAR_ES_BOOTSTRAP_CHECKS_DISABLE=true sonarqube:community >/dev/null
fi
echo "Esperando a SonarQube..."
for i in $(seq 1 90); do
  curl -s "$SQ/api/system/status" | grep -q '"status":"UP"' && break; sleep 5
done
# Primer inicio: cambiar la contraseña por defecto del administrador
curl -s -u admin:admin -X POST "$SQ/api/users/change_password" \
  --data-urlencode "login=admin" --data-urlencode "previousPassword=admin" --data-urlencode "password=$PASS" >/dev/null
TOKEN=$(curl -s -u "admin:$PASS" -X POST "$SQ/api/user_tokens/generate" --data-urlencode "name=atlas-$CLAVE-$(date +%s)" \
  | python -c "import json,sys;print(json.load(sys.stdin)['token'])")
curl -s -u "admin:$PASS" -X POST "$SQ/api/projects/create" --data-urlencode "project=$CLAVE" --data-urlencode "name=$CLAVE" >/dev/null

docker run --rm --add-host=host.docker.internal:host-gateway -v "$(win "$RAIZ"):/usr/src" sonarsource/sonar-scanner-cli:latest \
  -Dsonar.host.url=http://host.docker.internal:9000 -Dsonar.token="$TOKEN" -Dsonar.projectKey="$CLAVE" \
  -Dsonar.projectName="$CLAVE" -Dsonar.sources=BACKEND,FRONTEND \
  -Dsonar.exclusions="**/node_modules/**,**/dist/**,**/build/**,**/coverage/**,**/test/**,**/.env,**/sql/dump-atlas.sql" \
  -Dsonar.javascript.lcov.reportPaths=BACKEND/coverage/lcov.info \
  -Dsonar.scm.disabled=true > "$OUT/sonar_scanner.txt" 2>&1
tail -n 3 "$OUT/sonar_scanner.txt"
TAREA=$(grep -o 'api/ce/task?id=[A-Za-z0-9_-]*' "$OUT/sonar_scanner.txt" | tail -1 | cut -d= -f2)
for i in $(seq 1 60); do
  E=$(curl -s -u "admin:$PASS" "$SQ/api/ce/task?id=$TAREA" | python -c "import json,sys;print(json.load(sys.stdin)['task']['status'])")
  [ "$E" = "SUCCESS" ] || [ "$E" = "FAILED" ] && break; sleep 3
done
M="ncloc,bugs,vulnerabilities,code_smells,security_hotspots,duplicated_lines_density,coverage,reliability_rating,security_rating,sqale_rating,security_review_rating,software_quality_security_issues,software_quality_reliability_issues,software_quality_maintainability_issues"
curl -s -u "admin:$PASS" "$SQ/api/measures/component?component=$CLAVE&metricKeys=$M" > "$OUT/sonar_medidas.json"
curl -s -u "admin:$PASS" "$SQ/api/qualitygates/project_status?projectKey=$CLAVE" > "$OUT/sonar_puerta_calidad.json"
curl -s -u "admin:$PASS" "$SQ/api/issues/search?componentKeys=$CLAVE&ps=500&resolved=false" > "$OUT/sonar_issues.json"
curl -s -u "admin:$PASS" "$SQ/api/hotspots/search?project=$CLAVE&ps=500" > "$OUT/sonar_hotspots.json"
python -X utf8 - "$OUT" <<'EOF'
import json, sys, collections, os
o = sys.argv[1]
m = {x["metric"]: x.get("value") for x in json.load(open(os.path.join(o, "sonar_medidas.json"), encoding="utf-8"))["component"]["measures"]}
g = json.load(open(os.path.join(o, "sonar_puerta_calidad.json"), encoding="utf-8"))["projectStatus"]["status"]
iss = json.load(open(os.path.join(o, "sonar_issues.json"), encoding="utf-8"))
hs = json.load(open(os.path.join(o, "sonar_hotspots.json"), encoding="utf-8"))
sev = collections.Counter(i.get("severity") for i in iss["issues"])
tipo = collections.Counter(i.get("type") for i in iss["issues"])
lineas = [f"Líneas de código: {m.get('ncloc')}", f"Issues abiertos: {iss['total']} · por tipo {dict(tipo)} · por severidad {dict(sev)}",
          f"Bugs: {m.get('bugs')} · Vulnerabilidades: {m.get('vulnerabilities')} · Code smells: {m.get('code_smells')}",
          f"Security hotspots: {hs['paging']['total']} · Duplicación: {m.get('duplicated_lines_density')} % · Cobertura: {m.get('coverage')} %",
          f"Calificaciones (1=A … 5=E): fiabilidad {m.get('reliability_rating')} · seguridad {m.get('security_rating')} · mantenibilidad {m.get('sqale_rating')} · revisión de seguridad {m.get('security_review_rating')}",
          f"Puerta de calidad: {g}"]
open(os.path.join(o, "sonar_resumen.txt"), "w", encoding="utf-8").write("\n".join(lineas) + "\n")
print("\n".join(lineas))
EOF
