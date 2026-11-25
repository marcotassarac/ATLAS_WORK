// DEF-15 (RF-5.5): enlaces firmados para compartir un documento con un tercero.
// - Se firman con una clave derivada del secreto JWT, distinta de la de las sesiones:
//   un enlace no sirve como sesión y una sesión no sirve como enlace.
// - El enlace identifica un solo contrato y una sola empresa, y vence.
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { JWT_SECRET } = require("./config");

const CLAVE_ENLACES = crypto.createHmac("sha256", JWT_SECRET).update("atlas:enlaces-documentos").digest();
const TIPO = "enlace_documento";

function crearEnlace(contratoId, empresaId, minutos) {
  const token = jwt.sign({ tipo: TIPO, contratoId, empresaId }, CLAVE_ENLACES, {
    algorithm: "HS256",
    expiresIn: minutos * 60,
    jwtid: crypto.randomUUID(),
  });
  return { token, expiraEn: new Date(Date.now() + minutos * 60 * 1000) };
}

function verificarEnlace(token) {
  try {
    const datos = jwt.verify(token, CLAVE_ENLACES, { algorithms: ["HS256"] });
    if (datos.tipo !== TIPO || !Number.isInteger(datos.contratoId) || !Number.isInteger(datos.empresaId)) return null;
    return datos;
  } catch {
    return null;
  }
}

module.exports = { crearEnlace, verificarEnlace };
