// Video de la prueba de estrés con Apache JMeter sobre Atlas v2.1.
// Reproduce la consola real de la ejecución (con sus tiempos, acelerada) y recorre el dashboard HTML de JMeter.
// Uso: node video_jmeter.mjs <carpeta_jmeter> <carpeta_salida>
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DIR = process.argv[2];
const SALIDA = process.argv[3] || "video_jmeter";
fs.mkdirSync(SALIDA, { recursive: true });
const lineas = fs.readFileSync(path.join(DIR, "consola_tiempos.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
const R = JSON.parse(fs.readFileSync(path.join(DIR, "resumen.json"), "utf8"));
const ACELERACION = 8; // 1 segundo de video = 8 segundos de ejecución real
const coma = (n) => String(n).replace(".", ",");
const miles = (n) => Number(n).toLocaleString("es-CL");

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1280, height: 720 }, locale: "es-CL", recordVideo: { dir: SALIDA, size: { width: 1280, height: 720 } } });
const page = await ctx.newPage();
const pausa = (ms) => page.waitForTimeout(ms);

async function subtitulo(texto, ms = 3500) {
  await page.evaluate((t) => {
    let d = document.getElementById("__subtitulo");
    if (!d) {
      d = document.createElement("div");
      d.id = "__subtitulo";
      d.style.cssText = "position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:2147483647;" +
        "background:rgba(14,40,41,.94);color:#fff;font:600 21px/1.35 Segoe UI,Arial,sans-serif;padding:12px 22px;" +
        "border-radius:10px;max-width:1150px;text-align:center;box-shadow:0 6px 24px rgba(0,0,0,.35);border-left:6px solid #4BBC7F";
      document.body.appendChild(d);
    }
    d.textContent = t;
    d.style.display = "block";
  }, texto);
  await pausa(ms);
  await page.evaluate(() => { const d = document.getElementById("__subtitulo"); if (d) d.style.display = "none"; }).catch(() => {});
}

async function diapositiva(titulo, cuerpo, ms) {
  await page.setContent(`<!doctype html><html lang="es"><body style="margin:0;height:100vh;display:flex;flex-direction:column;
    justify-content:center;align-items:center;background:linear-gradient(135deg,#0f3d3e,#1B7576);color:#fff;font-family:Segoe UI,Arial">
    <div style="font-size:44px;font-weight:700;margin-bottom:20px;text-align:center">${titulo}</div>${cuerpo}</body></html>`);
  await pausa(ms);
}

// 1. Portada
await diapositiva("Prueba de estrés con Apache JMeter 5.6.3",
  `<div style="font-size:26px;margin:6px">Sistema de Gestión Atlas · versión v2.1</div>
   <div style="font-size:22px;margin:6px;opacity:.9">Realizada por Martín Villegas, Belén Lisboa y Marco Tassara</div>
   <div style="font-size:20px;margin-top:26px;opacity:.85">Objetivo: encontrar el límite del sistema, más allá de los 200 usuarios que exige el ERS (NFR-PERF-3)</div>`, 5500);

// 2. Plan de prueba
const filas = R.escalones.map((e) => `<tr><td>Escalón ${e.usuarios} usuarios</td><td>${e.usuarios}</td><td>10 s</td><td>60 s</td></tr>`).join("");
await page.setContent(`<!doctype html><html lang="es"><body style="margin:0;background:#f4f8f8;font-family:Segoe UI,Arial;color:#17262b">
  <div style="background:#0f3d3e;color:#fff;padding:18px 36px;font-size:30px;font-weight:700">Plan versionado: pruebas/jmeter/estres_atlas.jmx</div>
  <div style="display:flex;gap:28px;padding:24px 36px">
    <div style="flex:1.2">
      <div style="font-size:20px;font-weight:700;color:#1B7576;margin-bottom:8px">1 · setUp: inicio de sesión</div>
      <div style="font-size:17px;margin-bottom:18px">POST /api/autenticacion/login → se extrae el token JWT y se comparte con todos los hilos.</div>
      <div style="font-size:20px;font-weight:700;color:#1B7576;margin-bottom:8px">2 · Seis escalones consecutivos</div>
      <table style="border-collapse:collapse;font-size:17px;width:100%">
        <tr style="background:#1B7576;color:#fff"><th style="text-align:left;padding:6px">Grupo de hilos</th><th>Usuarios</th><th>Subida</th><th>Duración</th></tr>
        ${filas.replaceAll("<td>", '<td style="padding:5px 8px;border-bottom:1px solid #cfdede">')}
      </table>
    </div>
    <div style="flex:1">
      <div style="font-size:20px;font-weight:700;color:#1B7576;margin-bottom:8px">3 · Cada usuario repite</div>
      <div style="font-size:17px;line-height:1.7">GET /api/clientes<br>GET /api/contratos<br>GET /api/metricas<br>con 500 ms de pausa entre acciones</div>
      <div style="font-size:20px;font-weight:700;color:#1B7576;margin:18px 0 8px">4 · Ambiente</div>
      <div style="font-size:17px;line-height:1.6">JMeter en la red interna de Docker contra nginx por HTTPS: se mide el sistema completo (TLS, proxy, API y PostgreSQL).</div>
      <div style="font-size:20px;font-weight:700;color:#1B7576;margin:18px 0 8px">5 · Criterio</div>
      <div style="font-size:17px;line-height:1.6">Un escalón se sostiene si su error es menor a 1 % y su p95 menor a 1 segundo.</div>
    </div>
  </div></body></html>`);
await pausa(1500);
await subtitulo("El plan sube la carga por escalones hasta que el sistema deja de responder bien.", 6500);

// 3. Consola real, reproducida con sus tiempos
const duracionReal = lineas[lineas.length - 1].t;
await page.setContent(`<!doctype html><html lang="es"><body style="margin:0;background:#0d1117;font-family:Consolas,monospace;color:#c9d1d9;height:100vh;display:flex">
  <div style="flex:1;display:flex;flex-direction:column;min-width:0">
    <div style="background:#161b22;padding:10px 16px;font:600 15px Segoe UI,Arial;color:#8b949e">Terminal · ejecución real del ${new Date().toLocaleDateString("es-CL")} · reproducida a ${ACELERACION}× su velocidad</div>
    <div style="padding:10px 16px;color:#7ee787;font-size:13px">$ docker run --network atlas-network justb4/jmeter -n -t estres_atlas.jmx -Jhost=atlas-frontend -Jport=8443 -l resultados.jtl -e -o dashboard</div>
    <pre id="t" style="margin:0;padding:0 16px;font-size:12.5px;line-height:1.45;flex:1;overflow:hidden;white-space:pre-wrap"></pre>
  </div>
  <div style="width:300px;background:#0f3d3e;color:#fff;font-family:Segoe UI,Arial;padding:22px">
    <div style="font-size:15px;opacity:.8">Usuarios activos</div><div id="u" style="font-size:64px;font-weight:700">0</div>
    <div style="font-size:15px;opacity:.8;margin-top:10px">Solicitudes por segundo</div><div id="r" style="font-size:40px;font-weight:700">—</div>
    <div style="font-size:15px;opacity:.8;margin-top:10px">Tiempo medio</div><div id="m" style="font-size:40px;font-weight:700">—</div>
    <div style="font-size:15px;opacity:.8;margin-top:10px">Errores</div><div id="e" style="font-size:40px;font-weight:700">0 %</div>
    <div id="estado" style="margin-top:22px;padding:10px;border-radius:8px;background:#237A4B;font-size:18px;font-weight:600;text-align:center">Se sostiene</div>
    <div style="font-size:13px;opacity:.7;margin-top:14px">Tiempo de prueba: <span id="reloj">00:00</span></div>
  </div></body></html>`);
await page.evaluate(({ lineas, F }) => new Promise((fin) => {
  const t = document.getElementById("t"), ini = performance.now();
  let i = 0;
  const set = (id, v) => { document.getElementById(id).textContent = v; };
  function tick() {
    const seg = ((performance.now() - ini) / 1000) * F;
    while (i < lineas.length && lineas[i].t <= seg) {
      const l = lineas[i].l;
      const s = document.createElement("span");
      s.textContent = l + "\n";
      if (/Err:\s+[1-9]/.test(l)) s.style.color = "#ff7b72";
      else if (/^summary \+/.test(l)) s.style.color = "#e3b341";
      t.appendChild(s);
      const m = l.match(/^summary \+\s+\d+ in [\d:]+ =\s+([\d.]+)\/s Avg:\s+(\d+).*Err:\s+\d+ \(([\d.]+)%\) Active: (\d+)/);
      if (m) {
        set("r", m[1].replace(".", ",")); set("m", m[2] + " ms"); set("e", m[3].replace(".", ",") + " %"); set("u", m[4]);
        const mal = parseFloat(m[3]) >= 1 || parseInt(m[2]) >= 1000;
        const st = document.getElementById("estado");
        st.textContent = mal ? "Punto de quiebre" : "Se sostiene";
        st.style.background = mal ? "#C62828" : "#237A4B";
      }
      i++;
    }
    while (t.scrollHeight > t.clientHeight && t.firstChild) t.removeChild(t.firstChild);
    const r = Math.min(seg, lineas[lineas.length - 1].t);
    set("reloj", `${String(Math.floor(r / 60)).padStart(2, "0")}:${String(Math.floor(r % 60)).padStart(2, "0")}`);
    if (i < lineas.length) requestAnimationFrame(tick); else setTimeout(fin, 1500);
  }
  tick();
}), { lineas, F: ACELERACION });
await subtitulo(`Terminado: ${miles(R.escalones.reduce((a, e) => a + e.solicitudes, 0))} solicitudes en ${Math.round(duracionReal / 60)} minutos. JMeter genera el dashboard HTML con los resultados.`, 4500);

// 4. Dashboard de JMeter
const dash = (p) => pathToFileURL(path.join(DIR, "dashboard", p)).href;
await page.goto(dash("index.html"));
await pausa(2500);
await subtitulo("Dashboard generado por JMeter: resumen de la ejecución y estadísticas por solicitud.", 4000);
await page.evaluate(() => { const h = [...document.querySelectorAll("div.panel-heading, h3, h4")].find((x) => /Statistics/i.test(x.textContent)); if (h) h.scrollIntoView({ behavior: "smooth", block: "start" }); });
await pausa(1200);
await subtitulo("La tabla de estadísticas muestra el tiempo medio, los percentiles 90, 95 y 99 y la tasa de error de cada endpoint.", 5000);
await page.goto(dash("content/pages/OverTime.html"));
await pausa(2500);
await subtitulo("Tiempo de respuesta en el tiempo: bajo y estable hasta 200 usuarios; sube con 400 y se dispara con 800.", 5000);
await page.goto(dash("content/pages/Throughput.html"));
await pausa(2000);
await page.evaluate(() => { const h = [...document.querySelectorAll("div.panel-heading, h3, h4")].find((x) => /Codes Per Second/i.test(x.textContent)); if (h) h.scrollIntoView({ behavior: "smooth", block: "start" }); });
await pausa(1500);
await subtitulo("Códigos de respuesta por segundo: desde 400 usuarios aparecen respuestas HTTP 502 de nginx; la API ya no alcanza a atender a todos.", 5500);

// 5. Resultado
const q = R.escalones.find((e) => e.usuarios === R.quiebre);
const filasR = R.escalones.map((e) => {
  const ok = e.error < 1 && e.p95 < 1000;
  return `<tr style="background:${ok ? "rgba(255,255,255,.06)" : "rgba(198,40,40,.55)"}"><td>${e.usuarios}</td><td>${coma(e.rps)}</td><td>${miles(e.p95)} ms</td><td>${coma(e.error)} %</td><td>${ok ? "Se sostiene" : "Quiebre"}</td></tr>`;
}).join("").replaceAll("<td>", '<td style="padding:7px 18px;text-align:center">');
await diapositiva(`Corrida 2 · capacidad sostenida: ${R.capacidad} usuarios`,
  `<table style="border-collapse:collapse;font-size:21px;margin:6px 0 18px">
     <tr style="background:#4BBC7F;color:#0f3d3e"><th style="padding:8px 18px">Usuarios</th><th style="padding:8px 18px">Solicitudes/s</th><th style="padding:8px 18px">p95</th><th style="padding:8px 18px">Error</th><th style="padding:8px 18px">Resultado</th></tr>${filasR}</table>
   <div style="font-size:21px;max-width:1050px;text-align:center">${q ? `Punto de quiebre con ${R.quiebre} usuarios (p95 ${miles(q.p95)} ms, error ${coma(q.error)} %). ` : ""}Cumple los 200 usuarios que exige el ERS. En la primera corrida, 400 usuarios se sostuvieron (0,36 % de error): 400 es la zona límite.</div>`, 9000);

const video = page.video();
await ctx.close();
await b.close();
const destino = path.join(SALIDA, "video_jmeter.webm");
fs.renameSync(await video.path(), destino);
console.log("Video:", destino);
