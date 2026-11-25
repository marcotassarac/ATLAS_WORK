// DEF-08: límites de intentos (OWASP A07:2021, CWE-307; ERS 2.4).
// - Por IP y nombre de usuario: 5 intentos fallidos en 15 minutos bloquean ese
//   usuario desde esa IP (fuerza bruta contra una cuenta).
// - Por IP: 30 intentos fallidos en 15 minutos (prueba de muchas cuentas).
// - Registro público: 10 por hora por IP (creación masiva de cuentas).
// Los intentos correctos no cuentan (skipSuccessfulRequests).
const { rateLimit, ipKeyGenerator } = require("express-rate-limit");

const QUINCE_MINUTOS = 15 * 60 * 1000;
const respuesta = (glosa) => ({ error: "Demasiados intentos", glosa });

const limiteLoginPorUsuario = rateLimit({
  windowMs: QUINCE_MINUTOS,
  limit: 5,
  skipSuccessfulRequests: true,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req) => `${ipKeyGenerator(req.ip)}|${String(req.body?.nombre_usuario || "").toLowerCase().slice(0, 100)}`,
  message: respuesta("Se bloquearon los intentos de inicio de sesión de este usuario por 15 minutos."),
});

const limiteLoginPorIp = rateLimit({
  windowMs: QUINCE_MINUTOS,
  limit: 30,
  skipSuccessfulRequests: true,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: respuesta("Demasiados intentos de inicio de sesión desde esta dirección. Intente más tarde."),
});

const limiteRegistro = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: respuesta("Se alcanzó el máximo de registros por hora desde esta dirección."),
});

module.exports = { limiteLoginPorUsuario, limiteLoginPorIp, limiteRegistro };
