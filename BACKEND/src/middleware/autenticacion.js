// DEF-04: autenticación obligatoria para toda la API (NFR-SEG-4, NFR-SEG-9).
// Antes cada ruta decidía si verificaba el token y varias no lo hacían.
// Ahora app.js aplica este middleware a todo lo que no es explícitamente público.
const jwt = require("jsonwebtoken");
const { JWT_SECRET } = require("../config");

function noAutorizado(res, glosa) {
  return res.status(401).json({ error: "No autorizado", glosa });
}

function autenticar(req, res, next) {
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
  req.usuario = {
    usuarioId: datos.usuarioId,
    nombreUsuario: datos.nombreUsuario,
    empresaId: datos.empresaId,
    empresaUsuarioId: datos.empresaUsuarioId,
  };
  return next();
}

module.exports = { autenticar };
