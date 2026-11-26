// DEF-18: cifrado en reposo de datos bancarios (NFR-SEG-3; OWASP A02:2021, CWE-311).
// AES-256-GCM (cifrado autenticado): además de ocultar el dato, detecta si el valor
// guardado fue alterado. Cada valor usa un IV aleatorio de 96 bits.
// Formato guardado: "enc:v1:" + base64(iv | etiqueta | texto cifrado). El prefijo de
// versión permite rotar la clave en el futuro sin ambigüedad.
const crypto = require("crypto");
const { DATA_ENCRYPTION_KEY } = require("../config");

const PREFIJO = "enc:v1:";
const CLAVE = Buffer.from(DATA_ENCRYPTION_KEY, "base64");
if (CLAVE.length !== 32) throw new Error("DATA_ENCRYPTION_KEY debe ser una clave de 32 bytes en base64");

function cifrar(texto) {
  if (texto === null || texto === undefined || texto === "") return texto;
  const iv = crypto.randomBytes(12);
  // v2.1: largo de etiqueta fijo (16 bytes); sin él se aceptarían etiquetas truncadas
  const c = crypto.createCipheriv("aes-256-gcm", CLAVE, iv, { authTagLength: 16 });
  const cifrado = Buffer.concat([c.update(String(texto), "utf8"), c.final()]);
  return PREFIJO + Buffer.concat([iv, c.getAuthTag(), cifrado]).toString("base64");
}

function estaCifrado(valor) {
  return typeof valor === "string" && valor.startsWith(PREFIJO);
}

function descifrar(valor) {
  if (!estaCifrado(valor)) return valor; // datos anteriores a la migración 007
  const datos = Buffer.from(valor.slice(PREFIJO.length), "base64");
  const d = crypto.createDecipheriv("aes-256-gcm", CLAVE, datos.subarray(0, 12), { authTagLength: 16 });
  d.setAuthTag(datos.subarray(12, 28));
  return Buffer.concat([d.update(datos.subarray(28)), d.final()]).toString("utf8");
}

function enmascarar(texto) {
  if (!texto) return texto;
  const t = String(texto);
  return `••••${t.slice(-4)}`;
}

module.exports = { cifrar, descifrar, enmascarar, estaCifrado };
