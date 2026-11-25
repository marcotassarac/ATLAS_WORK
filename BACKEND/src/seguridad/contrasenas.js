// DEF-03: almacenamiento seguro de contraseñas y política de contraseñas (ERS 2.4, NFR-SEG-2).
const bcrypt = require("bcryptjs");

const COSTO = 12; // 2^12 iteraciones: ~250 ms por hash, encarece los ataques de diccionario
const MINIMO = 12;

// Hash válido usado cuando el usuario no existe, para que el tiempo de respuesta
// del login sea el mismo y no revele qué usuarios existen (ERS 2.4).
const HASH_FICTICIO = bcrypt.hashSync("usuario-inexistente-atlas", COSTO);

function erroresPolitica(contrasena) {
  const errores = [];
  if (typeof contrasena !== "string" || contrasena.length < MINIMO) errores.push(`tener al menos ${MINIMO} caracteres`);
  if (!/[A-Z]/.test(contrasena || "")) errores.push("incluir una letra mayúscula");
  if (!/[a-z]/.test(contrasena || "")) errores.push("incluir una letra minúscula");
  if (!/[0-9]/.test(contrasena || "")) errores.push("incluir un número");
  if (!/[^A-Za-z0-9]/.test(contrasena || "")) errores.push("incluir un símbolo");
  return errores;
}

function mensajePolitica(errores) {
  return `La contraseña debe ${errores.join(", ")}.`;
}

function hashear(contrasena) {
  return bcrypt.hash(contrasena, COSTO);
}

async function verificar(contrasena, hash) {
  if (typeof contrasena !== "string" || typeof hash !== "string" || !/^\$2[aby]\$\d{2}\$/.test(hash)) {
    await bcrypt.compare("x", HASH_FICTICIO); // mismo costo de tiempo
    return false;
  }
  return bcrypt.compare(contrasena, hash);
}

module.exports = { erroresPolitica, mensajePolitica, hashear, verificar, HASH_FICTICIO };
