// DEF-04: autenticación obligatoria para toda la API (NFR-SEG-4, NFR-SEG-9).
// DEF-05: el rol se obtiene de la base en cada solicitud, no del cliente.
const jwt = require("jsonwebtoken");
const { JWT_SECRET } = require("../config");
const { pool } = require("../db");

function noAutorizado(res, glosa) {
  return res.status(401).json({ error: "No autorizado", glosa });
}

async function autenticar(req, res, next) {
  const cabecera = req.headers.authorization || "";
  if (!cabecera.startsWith("Bearer ")) return noAutorizado(res, "Debe iniciar sesión.");
  let datos;
  try {
    // Se fija el algoritmo para impedir tokens con alg "none" o algoritmos distintos.
    datos = jwt.verify(cabecera.slice(7), JWT_SECRET, { algorithms: ["HS256"] });
  } catch {
    return noAutorizado(res, "La sesión no es válida o expiró.");
  }
  if (!datos.usuarioId || !datos.empresaId) return noAutorizado(res, "La sesión no tiene una empresa asociada.");
  if (!datos.jti) return noAutorizado(res, "La sesión no es válida o expiró.");
  try {
    // DEF-07: un token revocado al cerrar sesión deja de aceptarse de inmediato (RF-1.2)
    const revocado = await pool.query("SELECT 1 FROM tokens_revocados WHERE jti = $1", [datos.jti]);
    if (revocado.rows.length) return noAutorizado(res, "La sesión fue cerrada.");

    // DEF-05: pertenencia y rol vigentes. Si el usuario fue eliminado de la empresa
    // o su rol cambió, el cambio aplica de inmediato aunque el token siga vigente.
    const { rows } = await pool.query(
      `SELECT eu.id, r.nombre AS rol
         FROM empresa_usuarios eu JOIN roles r ON r.id = eu.rol_id
        WHERE eu.usuario_id = $1 AND eu.empresa_id = $2
        ORDER BY eu.id DESC LIMIT 1`,
      [datos.usuarioId, datos.empresaId]
    );
    if (!rows.length) return noAutorizado(res, "El usuario ya no pertenece a la empresa.");
    req.usuario = {
      usuarioId: Number(datos.usuarioId),
      nombreUsuario: datos.nombreUsuario,
      empresaId: Number(datos.empresaId),
      empresaUsuarioId: Number(rows[0].id),
      rol: rows[0].rol,
      jti: datos.jti,
      exp: datos.exp,
    };
    return next();
  } catch (err) {
    return next(err);
  }
}

module.exports = { autenticar };
