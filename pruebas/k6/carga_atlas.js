// Prueba de carga - Sistema Atlas (ISY1102 EV3)
// CP-05 / NFR-PERF-1: p95 < 300 ms en operaciones CRUD con carga normal (10 usuarios, 1 minuto).
// CP-18 / NFR-PERF-3: 200 usuarios concurrentes durante 5 minutos con error < 1 %.
//
// Ejecución (Docker):
//   docker run --rm -v "$PWD/pruebas/k6:/scripts" -e API_URL=http://host.docker.internal:4450 \
//     grafana/k6 run /scripts/carga_atlas.js --summary-export /scripts/resumen.json
import http from "k6/http";
import { check, sleep } from "k6";
import { Trend, Rate } from "k6/metrics";

const API = (__ENV.API_URL || "http://host.docker.internal:4450").replace(/\/$/, "");
const USUARIO = __ENV.ATLAS_USER || "admin";
const CLAVE = __ENV.ATLAS_PASS || "admin";

const lecturaNormal = new Trend("atlas_lectura_carga_normal", true);
const lecturaConcurrente = new Trend("atlas_lectura_200_usuarios", true);
const erroresConcurrentes = new Rate("atlas_errores_200_usuarios");

export const options = {
  insecureSkipTLSVerify: true, // certificado autofirmado del laboratorio
  scenarios: {
    carga_normal: {
      executor: "constant-vus", vus: 10, duration: "1m", exec: "cargaNormal", tags: { escenario: "normal" },
    },
    concurrencia_200: {
      executor: "ramping-vus", startTime: "1m10s", exec: "concurrencia", tags: { escenario: "200" },
      stages: [{ duration: "30s", target: 200 }, { duration: "5m", target: 200 }, { duration: "10s", target: 0 }],
    },
  },
  thresholds: {
    "atlas_lectura_carga_normal": ["p(95)<300"],          // NFR-PERF-1
    "atlas_errores_200_usuarios": ["rate<0.01"],           // NFR-PERF-3
  },
  summaryTrendStats: ["avg", "min", "med", "p(90)", "p(95)", "max"],
};

export function setup() {
  const r = http.post(`${API}/autenticacion/login`, JSON.stringify({ nombre_usuario: USUARIO, password: CLAVE }),
    { headers: { "Content-Type": "application/json" } });
  check(r, { "login 200": (x) => x.status === 200 });
  return { token: r.json("token") };
}

function leer(token, metrica, errores) {
  const h = { headers: { Authorization: `Bearer ${token}` } };
  for (const ruta of ["/clientes", "/contratos"]) {
    const r = http.get(`${API}${ruta}`, h);
    metrica.add(r.timings.duration);
    const ok = check(r, { [`${ruta} 200`]: (x) => x.status === 200 });
    if (errores) errores.add(!ok);
  }
}

export function cargaNormal(data) {
  leer(data.token, lecturaNormal, null);
  sleep(1);
}

export function concurrencia(data) {
  leer(data.token, lecturaConcurrente, erroresConcurrentes);
  sleep(1);
}

export function handleSummary(data) {
  const m = (n, s) => (data.metrics[n] && data.metrics[n].values[s] !== undefined ? data.metrics[n].values[s] : null);
  const fmt = (v) => (v === null ? "-" : `${v.toFixed(1)} ms`);
  const lineas = [
    "Atlas · prueba de carga k6",
    `API: ${API}`,
    "",
    "Escenario 1 · carga normal (10 usuarios, 1 min) · NFR-PERF-1",
    `  mediana ${fmt(m("atlas_lectura_carga_normal", "med"))} · p95 ${fmt(m("atlas_lectura_carga_normal", "p(95)"))} · máx ${fmt(m("atlas_lectura_carga_normal", "max"))}`,
    `  umbral p95 < 300 ms: ${data.metrics.atlas_lectura_carga_normal && data.metrics.atlas_lectura_carga_normal.thresholds["p(95)<300"].ok ? "CUMPLE" : "NO CUMPLE"}`,
    "",
    "Escenario 2 · 200 usuarios concurrentes (5 min) · NFR-PERF-3",
    `  mediana ${fmt(m("atlas_lectura_200_usuarios", "med"))} · p95 ${fmt(m("atlas_lectura_200_usuarios", "p(95)"))} · máx ${fmt(m("atlas_lectura_200_usuarios", "max"))}`,
    `  tasa de error ${((m("atlas_errores_200_usuarios", "rate") || 0) * 100).toFixed(2)} % · umbral < 1 %: ${data.metrics.atlas_errores_200_usuarios && data.metrics.atlas_errores_200_usuarios.thresholds["rate<0.01"].ok ? "CUMPLE" : "NO CUMPLE"}`,
    `  solicitudes totales: ${m("http_reqs", "count")} · tasa ${(m("http_reqs", "rate") || 0).toFixed(1)} req/s`,
    "",
  ];
  return {
    stdout: lineas.join("\n"),
    "/salida/k6_resumen.txt": lineas.join("\n"),
    "/salida/k6_resumen.json": JSON.stringify(data, null, 2),
  };
}
