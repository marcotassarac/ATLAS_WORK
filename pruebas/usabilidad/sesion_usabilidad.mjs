// Prueba de usabilidad de Atlas v2.1 (CP-19, NFR-USAB-1 a NFR-USAB-4).
// Sesión guiada: el evaluador (Marco Tassara, líder de QA) realiza 11 tareas típicas de un
// administrador de pyme. Playwright ejecuta los pasos con pausas de lectura y registra, por
// tarea, el tiempo, los pasos, los errores encontrados, los mensajes que muestra el sistema
// y una captura; además graba un video de la sesión completa.
// Uso: node pruebas/usabilidad/sesion_usabilidad.mjs <carpeta_salida>   (FRONT_URL opcional)
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const OUT = process.argv[2] || "salida/usabilidad";
const FRONT = (process.env.FRONT_URL || "https://127.0.0.1:3443").replace(/\/$/, "");
const CAPS = path.join(OUT, "capturas");
fs.mkdirSync(CAPS, { recursive: true });
const sfx = String(Date.now()).slice(-4);
const USUARIO = `marco_tassara${sfx}`;
const CLAVE = "Tassara#Qa2026";
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n");

const b = await chromium.launch({ slowMo: 120 });
const ctx = await b.newContext({ viewport: { width: 1366, height: 768 }, ignoreHTTPSErrors: true, locale: "es-CL",
  recordVideo: { dir: OUT, size: { width: 1366, height: 768 } } });
const page = await ctx.newPage();
const leer = (ms = 900) => page.waitForTimeout(ms); // pausa de lectura del evaluador
const tareas = [];
let mensajes = [];
page.on("console", () => {});

async function capturarMensajes() {
  const t = await page.locator("[data-sonner-toast]").allInnerTexts().catch(() => []);
  for (const x of t) { const limpio = x.replace(/\s+/g, " ").trim(); if (limpio && !mensajes.includes(limpio)) mensajes.push(limpio); }
}
async function tarea(id, nombre, objetivo, fn) {
  mensajes = [];
  const t0 = Date.now();
  const r = { id, nombre, objetivo, pasos: 0, errores: [], completada: false, mensajes: [], captura: null };
  const paso = () => { r.pasos += 1; };
  try {
    await fn(paso, r);
    r.completada = true;
  } catch (e) {
    r.errores.push(`No se pudo completar: ${String(e.message).split("\n")[0]}`);
  }
  await capturarMensajes();
  r.mensajes = [...mensajes];
  r.segundos = Math.round((Date.now() - t0) / 100) / 10;
  r.captura = path.join("capturas", `${id}.png`).replaceAll("\\", "/");
  await page.screenshot({ path: path.join(OUT, r.captura) });
  tareas.push(r);
  console.log(`${id} ${r.completada ? "COMPLETADA" : "NO COMPLETADA"} ${r.segundos}s ${r.pasos} pasos · ${r.errores.length} errores · ${nombre}`);
}
async function escribir(paso, locator, valor) { await locator.fill(valor); paso(); await leer(250); }
async function clic(paso, locator) { await locator.click(); paso(); await leer(400); }
const campo = (etiqueta) => page.getByLabel(new RegExp("^" + etiqueta + "\\s*\\*?$")).first();

// T1: registro de la empresa
await tarea("U-01", "Registrar mi empresa y mi cuenta", "Crear la cuenta del administrador y la empresa aceptando la política de privacidad.", async (paso, r) => {
  await page.goto(`${FRONT}/login`); await leer();
  await clic(paso, page.getByTestId("link-registro"));
  await escribir(paso, page.getByTestId("input-registro-nombre-usuario"), USUARIO);
  await escribir(paso, page.getByTestId("input-registro-correo"), `${USUARIO}@comercialtassara.cl`);
  await escribir(paso, page.getByTestId("input-registro-password"), "tassara2026");
  await clic(paso, page.getByTestId("button-registro-continuar"));
  const aviso = await page.getByText(/Debe aceptar la política/).isVisible().catch(() => false);
  if (aviso) r.errores.push("Olvidó marcar la casilla de privacidad: la interfaz lo advirtió antes de continuar.");
  await clic(paso, page.getByTestId("checkbox-registro-politica"));
  await clic(paso, page.getByTestId("button-registro-continuar"));
  await escribir(paso, page.getByTestId("input-registro-nombre-empresa"), `Comercial Tassara ${sfx}`);
  await escribir(paso, page.getByTestId("input-registro-correo-empresa"), `contacto${sfx}@comercialtassara.cl`);
  await escribir(paso, page.getByTestId("input-registro-telefono"), "+56 2 2765 4321");
  await escribir(paso, page.getByTestId("input-registro-calle"), "Av. Vicuña Mackenna 4917");
  await escribir(paso, page.getByTestId("input-registro-comuna"), "San Joaquín");
  await escribir(paso, page.getByTestId("input-registro-region"), "Metropolitana");
  await clic(paso, page.getByTestId("button-registro-crear-cuenta"));
  await leer(1500); await capturarMensajes();
  if (mensajes.some((m) => /insegura/i.test(m))) {
    r.errores.push("La contraseña «tassara2026» no cumple la política; el mensaje indicó cada requisito faltante (largo mínimo, mayúscula y símbolo).");
    await clic(paso, page.getByTestId("button-registro-volver"));
    await escribir(paso, page.getByTestId("input-registro-password"), CLAVE);
    await clic(paso, page.getByTestId("button-registro-continuar"));
    await clic(paso, page.getByTestId("button-registro-crear-cuenta"));
  }
  await page.waitForURL(/login/, { timeout: 20000 });
});

// T2: inicio de sesión
await tarea("U-02", "Iniciar sesión", "Ingresar con el usuario y la contraseña recién creados.", async (paso) => {
  await escribir(paso, page.getByTestId("input-nombre-usuario"), USUARIO);
  await escribir(paso, page.getByTestId("input-password"), CLAVE);
  await clic(paso, page.getByTestId("button-login"));
  await page.getByTestId("button-layout-logout").waitFor({ timeout: 30000 });
  await leer(1500);
});

// T3: crear un cliente
await tarea("U-03", "Registrar un cliente", "Crear el cliente «Ferretería San Pablo» con sus datos de contacto y bancarios.", async (paso, r) => {
  await clic(paso, page.getByText("Clientes", { exact: true }).first());
  await clic(paso, page.getByRole("tab", { name: /crear cliente/i }));
  await escribir(paso, campo("Nombre completo"), "Ferretería San Pablo");
  await escribir(paso, campo("Correo"), "ventas@ferreteriasanpablo");
  await escribir(paso, campo("Teléfono"), "+56 9 5555 1234");
  await escribir(paso, campo("Nombre del banco"), "Banco de Prueba");
  await escribir(paso, campo("Nº de cuenta bancaria"), "0034567812");
  await clic(paso, page.getByRole("button", { name: /crear cliente/i }));
  await leer(1200); await capturarMensajes();
  if (mensajes.some((m) => /Datos inválidos|correo/i.test(m))) {
    r.errores.push("Escribió el correo sin dominio (.cl); el sistema indicó el campo exacto a corregir.");
    await escribir(paso, campo("Correo"), "ventas@ferreteriasanpablo.cl");
    await clic(paso, page.getByRole("button", { name: /crear cliente/i }));
    await leer(1200);
  }
});

// T4: encontrar el cliente
await tarea("U-04", "Encontrar el cliente en el listado", "Ubicar el cliente creado en la lista de clientes.", async (paso) => {
  await clic(paso, page.getByRole("tab", { name: /listar clientes/i }));
  await page.getByText("Ferretería San Pablo").first().waitFor({ timeout: 15000 });
  await leer(1200);
});

// T5: contrato con documento
await tarea("U-05", "Crear un contrato con su documento", "Crear un contrato para el cliente y adjuntar el PDF firmado.", async (paso) => {
  await clic(paso, page.getByText("Contratos", { exact: true }).first());
  await clic(paso, page.getByRole("tab", { name: /crear contrato/i }));
  await clic(paso, page.getByLabel("Cliente").first());
  await clic(paso, page.getByRole("option", { name: /Ferretería San Pablo/ }));
  await escribir(paso, campo("Título"), "Arriendo de bodega 2027");
  await page.getByLabel("Fecha inicio").fill("2027-01-01"); paso();
  await page.getByLabel("Fecha fin").fill("2027-12-31"); paso();
  await page.locator("input[type=file]").setInputFiles({ name: "contrato_bodega.pdf", mimeType: "application/pdf", buffer: PDF }); paso();
  await clic(paso, page.getByRole("button", { name: /crear contrato/i }));
  await leer(1500);
});

// T6: detalle y enlace para compartir
await tarea("U-06", "Compartir el documento del contrato", "Abrir el contrato y generar un enlace temporal para enviarlo al cliente.", async (paso) => {
  await clic(paso, page.getByRole("tab", { name: /listar contratos/i }));
  const token = await page.evaluate(() => localStorage.getItem("token"));
  const lista = await page.evaluate(async (t) => (await fetch("/api/contratos", { headers: { Authorization: `Bearer ${t}` } })).json(), token);
  await page.goto(`${FRONT}/contratos/${lista[0].id}`); paso();
  await page.getByTestId("button-layout-logout").waitFor();
  await leer(1000);
  await clic(paso, page.getByRole("button", { name: /compartir enlace/i }));
  await leer(1800);
});

// T7: crear un usuario editor
await tarea("U-07", "Dar acceso de solo lectura a un colaborador", "Crear el usuario de un colaborador con el rol editor.", async (paso) => {
  await clic(paso, page.getByText("Usuarios", { exact: true }).first());
  await clic(paso, page.getByRole("tab", { name: /crear usuario/i }));
  await escribir(paso, campo("Nombre de usuario"), `colaborador${sfx}`);
  await escribir(paso, campo("Correo electrónico"), `colaborador${sfx}@comercialtassara.cl`);
  await escribir(paso, campo("Contraseña"), "Colabora#2026x");
  await clic(paso, page.getByRole("button", { name: /crear usuario/i }));
  await leer(1500);
});

// T8: auditoría
await tarea("U-08", "Revisar quién hizo cada acción", "Consultar la auditoría y encontrar la creación del cliente.", async (paso) => {
  await clic(paso, page.getByText("Auditoría", { exact: true }).first());
  await page.getByText(/CLIENTES_CREAR/).first().waitFor({ timeout: 15000 });
  await leer(1500);
});

// T9: editar la cuenta propia
await tarea("U-09", "Actualizar mi correo", "Cambiar el correo de la propia cuenta desde «Editar cuenta».", async (paso) => {
  await clic(paso, page.getByTestId("button-layout-editar-cuenta"));
  const correo = page.getByLabel(/correo/i).first();
  await correo.waitFor({ timeout: 15000 });
  await escribir(paso, correo, `marco.tassara${sfx}@comercialtassara.cl`);
  await clic(paso, page.getByTestId("button-usuario-actualizar"));
  await leer(1500);
});

// T10: cerrar sesión
await tarea("U-10", "Cerrar sesión", "Salir del sistema de forma segura.", async (paso) => {
  await clic(paso, page.getByTestId("button-layout-logout"));
  await page.waitForURL(/login/, { timeout: 15000 });
  await leer(1000);
});

// T11: ingreso desde el teléfono
await tarea("U-11", "Ingresar desde el teléfono", "Iniciar sesión en una pantalla de 360 px de ancho.", async (paso) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto(`${FRONT}/login`); await leer();
  await escribir(paso, page.getByTestId("input-nombre-usuario"), USUARIO);
  await escribir(paso, page.getByTestId("input-password"), CLAVE);
  await clic(paso, page.getByTestId("button-login"));
  await page.getByTestId("button-layout-logout").waitFor({ timeout: 30000 }).catch(() => page.waitForURL((u) => !u.pathname.startsWith("/login")));
  await leer(1500);
});

const video = page.video();
await ctx.close();
await b.close();
fs.renameSync(await video.path(), path.join(OUT, "sesion_usabilidad.webm"));
const resumen = {
  evaluador: "Marco Tassara (líder de QA)", fecha: new Date().toLocaleString("es-CL", { hour12: false }), version: "v2.1",
  completadas: tareas.filter((t) => t.completada).length, total: tareas.length,
  segundos: Math.round(tareas.reduce((a, t) => a + t.segundos, 0)), errores: tareas.reduce((a, t) => a + t.errores.length, 0), tareas,
};
fs.writeFileSync(path.join(OUT, "usabilidad.json"), JSON.stringify(resumen, null, 2), "utf-8");
console.log(`\nTareas completadas: ${resumen.completadas}/${resumen.total} · ${resumen.segundos} s · ${resumen.errores} errores de uso`);
