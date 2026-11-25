// Pruebas de interfaz automatizadas - Sistema Atlas (ISY1102 EV3)
// Playwright (Chromium, Firefox y WebKit) + axe-core (WCAG 2.1 AA).
//
// Variables de entorno:
//   FRONT_URL   URL del frontend (por defecto http://localhost:3350)
//   API_URL     URL de la API    (por defecto http://localhost:4450)
//   OUT_DIR     carpeta de resultados (por defecto resultados/)
//   CICLO, VERSION_SUT  datos que se registran en el resultado
//
// Salida: OUT_DIR/e2e.json y capturas en OUT_DIR/capturas/
import { chromium, firefox, webkit } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import fs from "node:fs";
import path from "node:path";

const FRONT = (process.env.FRONT_URL || "http://localhost:3350").replace(/\/$/, "");
const API = (process.env.API_URL || "http://localhost:4450").replace(/\/$/, "");
const OUT = process.env.OUT_DIR || "resultados";
const CICLO = process.env.CICLO || "1";
const VERSION = process.env.VERSION_SUT || "v1.0";
const CAPS = path.join(OUT, "capturas");
fs.mkdirSync(CAPS, { recursive: true });
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"; // certificado autofirmado del laboratorio

const ahora = () => new Date().toLocaleString("es-CL", { hour12: false }).replace(",", "");
const casos = [];

function nuevoCaso(id, nombre, requisitos, tipo, esperado, herramienta) {
  const c = { id, nombre, requisitos, tipo, esperado, herramienta, estado: null, nota: "",
    pasos: [], inicio: ahora(), fin: null, ciclo: CICLO, version: VERSION };
  casos.push(c);
  return c;
}
function paso(c, descripcion, ok, obtenido = "", captura = null) {
  c.pasos.push({ descripcion, ok: !!ok, obtenido, captura });
  return ok;
}
function cerrar(c) {
  c.fin = ahora();
  if (!c.estado) c.estado = c.pasos.length && c.pasos.every((p) => p.ok) ? "PASA" : "FALLA";
  console.log(`${c.id.padEnd(9)} ${c.estado.padEnd(10)} ${c.pasos.filter((p) => p.ok).length}/${c.pasos.length}  ${c.nombre}`);
}
async function captura(page, nombre) {
  const f = path.join(CAPS, `${nombre}.png`);
  await page.screenshot({ path: f, fullPage: false });
  return path.relative(OUT, f).replaceAll("\\", "/");
}
async function loginUI(page, usuario, clave) {
  await page.goto(`${FRONT}/login`, { waitUntil: "networkidle" });
  await page.getByTestId("input-nombre-usuario").fill(usuario);
  await page.getByTestId("input-password").fill(clave);
  await page.getByTestId("button-login").click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 }).catch(() => {});
  await page.waitForLoadState("networkidle").catch(() => {});
}
async function apiLogin(usuario, clave) {
  const r = await fetch(`${API}/autenticacion/login`, { method: "POST",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nombre_usuario: usuario, password: clave }) });
  return (await r.json().catch(() => ({}))).token;
}

const navegador = await chromium.launch();
const ctxOpts = { ignoreHTTPSErrors: true, locale: "es-CL", viewport: { width: 1366, height: 768 } };

// ---------------------------------------------------------------- CP-01 UI
{
  const c = nuevoCaso("CP-01-UI", "Inicio de sesión del administrador desde la interfaz", "RF-1.1",
    "Funcional (interfaz)", "El administrador ingresa con sus credenciales y llega al panel principal.",
    "Playwright 1.x + Chromium");
  const ctx = await navegador.newContext(ctxOpts);
  const page = await ctx.newPage();
  try {
    await loginUI(page, "admin", "admin");
    const url = new URL(page.url()).pathname;
    paso(c, "Tras ingresar, la aplicación sale de /login", !url.startsWith("/login"), `Ruta actual: ${url}`,
      await captura(page, `CP-01-UI_panel_admin`));
    const menu = await page.getByText("Clientes", { exact: true }).first().isVisible().catch(() => false);
    paso(c, "El menú lateral muestra el módulo Clientes", menu, menu ? "Menú visible" : "Menú no visible");
  } catch (e) { c.estado = "BLOQUEADO"; c.nota = String(e); }
  cerrar(c);
  await ctx.close();
}

// ---------------------------------------------------------------- CP-04 UI
{
  const c = nuevoCaso("CP-04-UI", "La interfaz del editor no ofrece acciones de administración", "RF-3.2, RB-4, NFR-USAB-3",
    "Seguridad (control de acceso en la interfaz)", "Al ingresar como editor no aparecen el módulo Usuarios ni los botones para crear, editar o eliminar.",
    "Playwright 1.x + Chromium");
  const ctx = await navegador.newContext(ctxOpts);
  const page = await ctx.newPage();
  try {
    await loginUI(page, "editor", "editor");
    const rol = await page.evaluate(() => localStorage.getItem("role"));
    await page.waitForTimeout(1500);
    const visibles = (t) => page.evaluate((txt) => [...document.querySelectorAll("body *")]
      .filter((e) => e.children.length === 0 && e.textContent.trim() === txt && e.getClientRects().length > 0).length, t);
    const usuarios = (await visibles("Usuarios")) > 0;
    paso(c, "El menú del editor no muestra el módulo Usuarios", !usuarios,
      `Módulo Usuarios visible: ${usuarios ? "sí" : "no"} · rol que usa la interfaz (localStorage): «${rol}»`, await captura(page, "CP-04-UI_menu_editor"));
    const etiquetaAdmin = (await visibles("Administrador")) > 0;
    paso(c, "El perfil del editor no se muestra como «Administrador»", !etiquetaAdmin,
      `Etiqueta de rol en el perfil: ${etiquetaAdmin ? "Administrador" : "otra"}`);
    await page.goto(`${FRONT}/clientes`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);
    const crear = await page.getByText(/nuevo cliente|crear cliente/i).first().isVisible().catch(() => false);
    const acciones = await page.locator("[data-testid^='button-cliente'], button:has-text('Eliminar'), [aria-label*='liminar'], [aria-label*='ditar']").count();
    paso(c, "En Clientes el editor no ve botones para crear, editar o eliminar", !crear && acciones === 0,
      `Botón crear visible: ${crear ? "sí" : "no"} · controles de edición/eliminación: ${acciones}`,
      await captura(page, "CP-04-UI_clientes_editor"));
    await page.goto(`${FRONT}/usuarios`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1000);
    const bloqueo = await page.getByText(/no autorizado/i).first().isVisible().catch(() => false);
    paso(c, "Al abrir /usuarios directamente, la interfaz indica «No autorizado»", bloqueo,
      bloqueo ? "Mensaje «No autorizado» visible" : "La pantalla de usuarios se muestra al editor",
      await captura(page, "CP-04-UI_usuarios_editor"));
  } catch (e) { c.estado = "BLOQUEADO"; c.nota = String(e); }
  cerrar(c);
  await ctx.close();
}

// ---------------------------------------------------------------- CP-07 accesibilidad
{
  const c = nuevoCaso("CP-07", "Accesibilidad WCAG 2.1 AA (adultos mayores)", "NFR-USAB-1",
    "Usabilidad / Accesibilidad", "axe-core no reporta infracciones críticas ni graves en login, registro y clientes; " +
    "el botón de ingreso tiene contraste ≥ 4,5:1; el formulario se completa solo con teclado.", "axe-core 4.x + Playwright (Chromium)");
  const ctx = await navegador.newContext(ctxOpts);
  const page = await ctx.newPage();
  const resumenAxe = {};
  try {
    for (const [nombre, ruta, requiereLogin] of [["login", "/login", false], ["registro", "/registro", false], ["clientes", "/clientes", true]]) {
      if (requiereLogin) await loginUI(page, "admin", "admin");
      await page.goto(`${FRONT}${ruta}`, { waitUntil: "networkidle" });
      await page.waitForTimeout(1200);
      const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      const graves = r.violations.filter((v) => ["critical", "serious"].includes(v.impact));
      resumenAxe[nombre] = r.violations.map((v) => ({ id: v.id, impacto: v.impact, nodos: v.nodes.length, ayuda: v.help }));
      paso(c, `Pantalla ${ruta}: sin infracciones críticas o graves de WCAG 2.1 AA`, graves.length === 0,
        `${r.violations.length} infracciones (${graves.length} críticas/graves): ` +
        (r.violations.map((v) => `${v.id} [${v.impact}, ${v.nodes.length}]`).join("; ") || "ninguna"),
        await captura(page, `CP-07_${nombre}`));
    }
    await ctx.clearCookies();
    await page.goto(`${FRONT}/login`, { waitUntil: "networkidle" });
    await page.evaluate(() => localStorage.clear());
    await page.goto(`${FRONT}/login`, { waitUntil: "networkidle" });
    const contraste = await page.getByTestId("button-login").evaluate((b) => {
      const rgb = (s) => (s.match(/\d+(\.\d+)?/g) || []).slice(0, 3).map(Number);
      const lum = ([r, g, bb]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(bb); };
      const cs = getComputedStyle(b);
      const L1 = lum(rgb(cs.color)), L2 = lum(rgb(cs.backgroundColor));
      return { ratio: (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05), color: cs.color, fondo: cs.backgroundColor };
    });
    paso(c, "El botón «Entrar» tiene contraste de al menos 4,5:1", contraste.ratio >= 4.5,
      `Contraste ${contraste.ratio.toFixed(2)}:1 (texto ${contraste.color} sobre ${contraste.fondo})`, await captura(page, "CP-07_contraste_boton"));
    await page.keyboard.press("Tab");
    await page.keyboard.type("admin");
    await page.keyboard.press("Tab");
    await page.keyboard.type("admin");
    await page.keyboard.press("Enter");
    await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 }).catch(() => {});
    const dentro = !new URL(page.url()).pathname.startsWith("/login");
    paso(c, "El inicio de sesión se completa solo con el teclado (Tab y Enter)", dentro,
      dentro ? "Ingreso correcto usando solo el teclado" : "No se pudo ingresar con el teclado");
    c.axe = resumenAxe;
  } catch (e) { c.estado = "BLOQUEADO"; c.nota = String(e); }
  cerrar(c);
  await ctx.close();
}

// ---------------------------------------------------------------- CP-08 compatibilidad
{
  const c = nuevoCaso("CP-08", "Compatibilidad entre navegadores y diseño responsivo", "NFR-COMPAT-1, NFR-COMPAT-2",
    "Compatibilidad", "En Chromium, Firefox y WebKit (motor de Safari), en escritorio, tablet y móvil (360 px), " +
    "el login no tiene desborde horizontal y sus controles son visibles y utilizables.", "Playwright (Chromium, Firefox, WebKit)");
  const motores = { Chromium: chromium, Firefox: firefox, WebKit: webkit };
  const vistas = [["escritorio", 1366, 768], ["tablet", 768, 1024], ["movil", 360, 740]];
  for (const [nombreMotor, motor] of Object.entries(motores)) {
    let b;
    try { b = await motor.launch(); } catch (e) { paso(c, `${nombreMotor}: el navegador se inicia`, false, String(e)); continue; }
    for (const [vista, w, h] of vistas) {
      const ctx = await b.newContext({ ...ctxOpts, viewport: { width: w, height: h } });
      const page = await ctx.newPage();
      try {
        await page.goto(`${FRONT}/login`, { waitUntil: "networkidle" });
        const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
        const boton = page.getByTestId("button-login");
        const caja = await boton.boundingBox();
        const visible = await boton.isVisible();
        const ancho = caja ? Math.round(caja.width) : 0;
        const ok = m.sw <= m.iw + 1 && visible && ancho >= 200;
        paso(c, `${nombreMotor} · ${vista} (${w}×${h}): sin desborde y con controles utilizables`, ok,
          `scrollWidth ${m.sw} px / ventana ${m.iw} px · botón visible: ${visible ? "sí" : "no"} · ancho del botón: ${ancho} px`,
          await captura(page, `CP-08_${nombreMotor}_${vista}`));
      } catch (e) { paso(c, `${nombreMotor} · ${vista}`, false, String(e)); }
      await ctx.close();
    }
    await b.close();
  }
  cerrar(c);
}

// ---------------------------------------------------------------- CP-13 UI
{
  const c = nuevoCaso("CP-13-UI", "Cierre de sesión desde la interfaz", "RF-1.2",
    "Funcional (interfaz) / Seguridad", "Al cerrar sesión se vuelve al login, el token desaparece del navegador y el servidor deja de aceptarlo.",
    "Playwright + Chromium");
  const ctx = await navegador.newContext(ctxOpts);
  const page = await ctx.newPage();
  try {
    await loginUI(page, "admin", "admin");
    const token = await page.evaluate(() => localStorage.getItem("token"));
    await page.getByTestId("button-layout-logout").click();
    await page.waitForURL((u) => u.pathname.startsWith("/login"), { timeout: 15000 }).catch(() => {});
    const enLogin = new URL(page.url()).pathname.startsWith("/login");
    const tokenDespues = await page.evaluate(() => localStorage.getItem("token"));
    paso(c, "Tras «Cerrar sesión» la aplicación vuelve a /login y borra el token del navegador", enLogin && !tokenDespues,
      `Ruta: ${new URL(page.url()).pathname} · token en localStorage: ${tokenDespues ? "presente" : "eliminado"}`,
      await captura(page, "CP-13-UI_logout"));
    const r = await fetch(`${API}/clientes`, { headers: { Authorization: `Bearer ${token}` } });
    paso(c, "El token usado antes del cierre ya no es aceptado por la API (401)", r.status === 401, `HTTP ${r.status}`);
  } catch (e) { c.estado = "BLOQUEADO"; c.nota = String(e); }
  cerrar(c);
  await ctx.close();
}

// ---------------------------------------------------------------- CP-15 UI (XSS en el navegador)
{
  const c = nuevoCaso("CP-15-UI", "XSS almacenado: ejecución en el navegador", "NFR-SEG-5",
    "Seguridad", "Un nombre de cliente con código HTML/JavaScript no se ejecuta al mostrarse en la lista de clientes.",
    "Playwright + Chromium");
  const ctx = await navegador.newContext(ctxOpts);
  const page = await ctx.newPage();
  let ejecutado = false;
  page.on("dialog", async (d) => { ejecutado = true; await d.dismiss(); });
  try {
    const token = await apiLogin("admin", "admin");
    const sfx = Date.now();
    const r = await fetch(`${API}/clientes`, { method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ nombre: `<img src=x onerror=alert('XSS-${sfx}')>`, correo: `xssui_${sfx}@cliente.cl`, telefono: "+56912345678" }) });
    paso(c, "La API rechaza el payload (400) o, si lo guarda, queda registrado para la verificación en pantalla",
      r.status === 400, `POST /clientes con payload XSS: HTTP ${r.status}`);
    await loginUI(page, "admin", "admin");
    await page.goto(`${FRONT}/clientes`, { waitUntil: "networkidle" });
    await page.waitForTimeout(6000);
    paso(c, "Al listar los clientes no se ejecuta ningún script (sin cuadros de alerta)", !ejecutado,
      ejecutado ? "Se ejecutó alert(): XSS explotable" : "No se ejecutó código: React escapa el contenido al mostrarlo",
      await captura(page, "CP-15-UI_lista_clientes"));
  } catch (e) { c.estado = "BLOQUEADO"; c.nota = String(e); }
  cerrar(c);
  await ctx.close();
}

// ---------------------------------------------------------------- CP-20 UI (normativa)
{
  const c = nuevoCaso("CP-20-UI", "Aviso de privacidad y consentimiento en el registro", "NFR-SEG-8",
    "Cumplimiento normativo", "El registro informa la finalidad del tratamiento, enlaza la política de privacidad y pide aceptar " +
    "el consentimiento antes de crear la cuenta (Ley 19.628 y Ley 21.719).", "Playwright + Chromium");
  const ctx = await navegador.newContext(ctxOpts);
  const page = await ctx.newPage();
  try {
    await page.goto(`${FRONT}/registro`, { waitUntil: "networkidle" });
    const texto = (await page.textContent("body")) || "";
    const aviso = /privacidad|datos personales/i.test(texto);
    paso(c, "La pantalla de registro informa sobre el tratamiento de datos personales", aviso,
      aviso ? "Aviso presente" : "No hay aviso de privacidad en la pantalla", await captura(page, "CP-20-UI_registro"));
    const casilla = await page.locator("input[type=checkbox]").count();
    paso(c, "Existe una casilla para aceptar la política de privacidad", casilla > 0, `Casillas de verificación: ${casilla}`);
    await page.goto(`${FRONT}/privacidad`, { waitUntil: "networkidle" });
    const p = (await page.textContent("body")) || "";
    const pol = /21\.719/.test(p) && /19\.628/.test(p);
    paso(c, "La política de privacidad está publicada y cita las leyes 19.628 y 21.719", pol,
      pol ? "Política publicada en /privacidad" : `/privacidad redirige a ${new URL(page.url()).pathname}`,
      await captura(page, "CP-20-UI_politica"));
  } catch (e) { c.estado = "BLOQUEADO"; c.nota = String(e); }
  cerrar(c);
  await ctx.close();
}

await navegador.close();
fs.writeFileSync(path.join(OUT, "e2e.json"), JSON.stringify({ ciclo: CICLO, version: VERSION, casos }, null, 2), "utf-8");
console.log(`\nInterfaz: ${casos.filter((c) => c.estado === "PASA").length}/${casos.length} casos aprobados · salida en ${OUT}`);
