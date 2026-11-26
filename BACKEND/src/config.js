// Configuración central de la API.
// DEF-01: los secretos se leen solo desde variables de entorno y no tienen valores
// por defecto en el código. Si faltan, la API no arranca (falla segura).
require("dotenv").config();

function requerida(nombre) {
  const valor = process.env[nombre];
  if (!valor || !valor.trim()) {
    throw new Error(`Falta la variable de entorno obligatoria ${nombre}`);
  }
  return valor;
}

const JWT_SECRET = requerida("JWT_SECRET");
if (JWT_SECRET.length < 32) {
  throw new Error("JWT_SECRET debe tener al menos 32 caracteres");
}

// DEF-16: orígenes autorizados para CORS (lista separada por comas). Sin valor, la API
// no habilita CORS para ningún origen externo.
const CORS_ORIGINS = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

// DEF-18: clave de 32 bytes (base64) para cifrar datos bancarios en reposo
const DATA_ENCRYPTION_KEY = requerida("DATA_ENCRYPTION_KEY");

module.exports = {
  DATA_ENCRYPTION_KEY,
  NODE_ENV: process.env.NODE_ENV || "development",
  CORS_ORIGINS,
  PORT: Number(process.env.PORT) || 3000,
  DATABASE_URL: requerida("DATABASE_URL"),
  JWT_SECRET,
};
