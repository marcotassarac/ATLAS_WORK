// Pruebas unitarias de los controles de seguridad (node:test, sin dependencias externas).
// Se ejecutan con: npm test   (cobertura: npm run test:cobertura)
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const express = require("express");

// Configuración mínima para cargar los módulos (no se conecta a ninguna base)
process.env.JWT_SECRET = "x".repeat(48);
process.env.DATABASE_URL = "postgres://prueba:prueba@127.0.0.1:1/prueba";
process.env.DATA_ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64");

const contrasenas = require("../src/seguridad/contrasenas");
const cifrado = require("../src/seguridad/cifrado");
const validacion = require("../src/validacion");
const errores = require("../src/errores");
const enlaces = require("../src/enlaces");
const { requiereRol } = require("../src/middleware/autorizacion");
const { subirDocumento } = require("../src/archivos");
const { limiteLoginPorUsuario } = require("../src/middleware/limites");

// Servidor HTTP efímero para probar middlewares de Express
async function servidor(app, fn) {
  const s = app.listen(0);
  await new Promise((r) => s.once("listening", r));
  try {
    return await fn(`http://127.0.0.1:${s.address().port}`);
  } finally {
    s.close();
  }
}

// Respuesta simulada para middlewares
function respuesta() {
  return {
    codigo: null, cuerpo: null, cabeceras: {},
    status(c) { this.codigo = c; return this; },
    json(b) { this.cuerpo = b; return this; },
  };
}

test("DEF-03 · política de contraseñas del ERS 2.4", () => {
  assert.deepEqual(contrasenas.erroresPolitica("Atlas#Prueba2026"), []);
  assert.ok(contrasenas.erroresPolitica("123").length >= 4);
  assert.ok(contrasenas.erroresPolitica("sinmayusculas#2026").some((e) => e.includes("mayúscula")));
  assert.ok(contrasenas.erroresPolitica("SinSimbolos2026x").some((e) => e.includes("símbolo")));
  assert.ok(contrasenas.erroresPolitica(undefined).length > 0);
});

test("DEF-03 · hash bcrypt y verificación", async () => {
  const hash = await contrasenas.hashear("Atlas#Prueba2026");
  assert.match(hash, /^\$2[aby]\$12\$/);
  assert.notEqual(hash, "Atlas#Prueba2026");
  assert.equal(await contrasenas.verificar("Atlas#Prueba2026", hash), true);
  assert.equal(await contrasenas.verificar("otra-clave", hash), false);
  // Un valor sin formato bcrypt (contraseña en texto plano heredada) nunca se acepta
  assert.equal(await contrasenas.verificar("admin", "admin"), false);
  assert.equal(await contrasenas.verificar("x", undefined), false);
});

test("DEF-18 · cifrado AES-256-GCM de datos bancarios", () => {
  const c = cifrado.cifrar("4567891230");
  assert.ok(c.startsWith("enc:v1:"));
  assert.ok(!c.includes("4567891230"));
  assert.notEqual(cifrado.cifrar("4567891230"), c, "cada cifrado usa un IV distinto");
  assert.equal(cifrado.descifrar(c), "4567891230");
  assert.equal(cifrado.descifrar("valor-heredado"), "valor-heredado");
  assert.equal(cifrado.cifrar(null), null);
  assert.equal(cifrado.enmascarar("4567891230"), "••••1230");
  const alterado = c.slice(0, -6) + (c.endsWith("AAAAAA") ? "BBBBBB" : "AAAAAA");
  assert.throws(() => cifrado.descifrar(alterado), "GCM detecta valores alterados");
});

test("DEF-09 · RUT con dígito verificador (módulo 11)", () => {
  for (const rut of ["11.111.111-1", "76.354.771-K", "12345678-5", "123456785"]) assert.equal(validacion.rutValido(rut), true, rut);
  for (const rut of ["11.111.111-2", "18933456-2", "abc", "1-9"]) assert.equal(validacion.rutValido(rut), false, rut);
});

test("DEF-09 · validación de clientes: rechaza formatos inválidos y marcado HTML", () => {
  const malo = validacion.validarCliente({
    nombre: "<script>alert(1)</script>", correo: "sin-arroba", telefono: "12-34-abc", rut: "11.111.111-2",
    dia_pago: "40", sitio_web: "javascript:alert(1)", metodo_pago: "bitcoin",
  });
  for (const campo of ["nombre", "correo", "telefono", "rut", "dia_pago", "sitio_web", "metodo_pago"]) {
    assert.ok(malo.errores[campo], `debe rechazar ${campo}`);
  }
  const bueno = validacion.validarCliente({ nombre: "  Cliente Válido ", correo: "A@B.CL", telefono: "+56 9 1234 5678", rut: "" });
  assert.deepEqual(bueno.errores, {});
  assert.equal(bueno.datos.nombre, "Cliente Válido");
  assert.equal(bueno.datos.correo, "a@b.cl");
  assert.equal(bueno.datos.rut, null);
  assert.equal(validacion.validarCliente({ correo: "a@b.cl" }).errores.nombre, "es obligatorio");
});

test("DEF-09 · validación de contratos: fechas reales y término posterior al inicio", () => {
  const r = validacion.validarContrato({ cliente_id: "3", titulo: "Contrato", fecha_inicio: "2026-02-30", fecha_fin: "2026-01-01" });
  assert.ok(r.errores.fecha_inicio);
  const r2 = validacion.validarContrato({ cliente_id: "3", titulo: "Contrato", fecha_inicio: "2026-03-01", fecha_fin: "2026-01-01" });
  assert.ok(r2.errores.fecha_fin);
  const parcial = validacion.validarContrato({ titulo: "Nuevo título" }, { parcial: true });
  assert.deepEqual(parcial.errores, {});
  assert.equal(parcial.datos.cliente_id, undefined);
});

test("DEF-05 · el editor recibe 403 en operaciones de administrador", () => {
  const mw = requiereRol("administrador");
  let siguio = false;
  const res = respuesta();
  mw({ usuario: { rol: "editor" } }, res, () => { siguio = true; });
  assert.equal(siguio, false);
  assert.equal(res.codigo, 403);
  mw({ usuario: { rol: "administrador" } }, respuesta(), () => { siguio = true; });
  assert.equal(siguio, true);
  const sinSesion = respuesta();
  mw({}, sinSesion, () => {});
  assert.equal(sinSesion.codigo, 403);
});

test("DEF-10 · errores de PostgreSQL se traducen sin detalles internos", () => {
  const casos = [
    [{ code: "23505", constraint: "usuarios_nombre_usuario_key", message: "duplicate key value violates" }, 409],
    [{ code: "23503", message: "violates foreign key constraint" }, 409],
    [{ code: "22P02", message: "invalid input syntax for type bigint" }, 400],
    [{ code: "23502", message: "null value in column" }, 400],
    [{ type: "entity.parse.failed" }, 400],
    [new Error("fallo inesperado con detalle interno"), 500],
  ];
  const original = console.error;
  console.error = () => {};
  try {
    for (const [err, codigo] of casos) {
      const res = respuesta();
      errores.manejadorErrores(err, { method: "GET", originalUrl: "/x" }, res, () => {});
      assert.equal(res.codigo, codigo);
      assert.doesNotMatch(JSON.stringify(res.cuerpo), /duplicate key|violates|invalid input|null value|detalle interno/i);
    }
  } finally {
    console.error = original;
  }
});

test("DEF-10 · los identificadores de la URL deben ser enteros positivos", () => {
  for (const id of ["1", "42", "999999"]) {
    let ok = false;
    errores.validarId({}, respuesta(), () => { ok = true; }, id);
    assert.equal(ok, true, id);
  }
  for (const id of ["0", "-1", "abc", "1 OR 1=1", "1;DROP"]) {
    const res = respuesta();
    errores.validarId({}, res, () => {}, id);
    assert.equal(res.codigo, 400, id);
  }
});

test("DEF-15 · enlaces para compartir: válidos, de un solo tipo y que no sirven como sesión", () => {
  const { token } = enlaces.crearEnlace(7, 3, 1);
  const datos = enlaces.verificarEnlace(token);
  assert.equal(datos.contratoId, 7);
  assert.equal(datos.empresaId, 3);
  assert.equal(enlaces.verificarEnlace(token.slice(0, -3) + "abc"), null, "firma alterada");
  assert.equal(enlaces.verificarEnlace("no-es-un-token"), null);
  // Un token de sesión (firmado con JWT_SECRET) no sirve como enlace
  const jwt = require("jsonwebtoken");
  const sesion = jwt.sign({ tipo: "enlace_documento", contratoId: 7, empresaId: 3 }, process.env.JWT_SECRET);
  assert.equal(enlaces.verificarEnlace(sesion), null);
});

test("DEF-11 · carga de documentos: tipo, contenido y tamaño", async () => {
  const app = express();
  app.post("/subir", subirDocumento, (req, res) => res.json({ nombre: req.documento?.nombre, mime: req.documento?.mime }));
  await servidor(app, async (base) => {
    const enviar = async (nombre, contenido) => {
      const f = new FormData();
      f.append("file", new Blob([contenido]), nombre);
      const r = await fetch(`${base}/subir`, { method: "POST", body: f });
      return { status: r.status, cuerpo: await r.json() };
    };
    const pdf = await enviar("contrato.pdf", Buffer.from("%PDF-1.4 contenido"));
    assert.equal(pdf.status, 200);
    assert.equal(pdf.cuerpo.mime, "application/pdf");
    assert.equal((await enviar("foto.png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]))).status, 200);
    assert.equal((await enviar("malware.exe", Buffer.from("MZ\x90\x00"))).status, 415);
    assert.equal((await enviar("factura.pdf", Buffer.from("MZ\x90\x00"))).status, 415, "exe disfrazado de pdf");
    assert.equal((await enviar("grande.pdf", Buffer.concat([Buffer.from("%PDF"), Buffer.alloc(11 * 1024 * 1024)]))).status, 413);
  });
});

test("DEF-08 · límite de intentos: el sexto intento fallido responde 429", async () => {
  const app = express();
  app.use(express.json());
  app.post("/login", limiteLoginPorUsuario, (req, res) => res.status(401).json({}));
  await servidor(app, async (base) => {
    const codigos = [];
    for (let i = 0; i < 7; i++) {
      const r = await fetch(`${base}/login`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nombre_usuario: "objetivo" }),
      });
      codigos.push(r.status);
    }
    assert.deepEqual(codigos, [401, 401, 401, 401, 401, 429, 429]);
  });
});
