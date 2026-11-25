// DEF-10: manejo centralizado de errores (NFR-SEG-5; OWASP A05:2021, CWE-209).
// Antes cada ruta devolvía err.message (mensajes internos de PostgreSQL) con HTTP 500.
// Ahora el usuario recibe un mensaje comprensible y el código HTTP correcto; el
// detalle técnico queda solo en el registro del servidor, con un código de referencia.
const crypto = require("crypto");

const CAMPOS_UNICOS = {
  clientes_correo_key: "correo",
  clientes_empresa_correo_uidx: "correo",
  usuarios_correo_key: "correo del usuario",
  usuarios_nombre_usuario_key: "nombre de usuario",
  empresas_correo_key: "correo de la empresa",
  roles_nombre_key: "nombre del rol",
};

function respuestaPara(err) {
  if (err.type === "entity.parse.failed") return [400, "Datos inválidos", "El cuerpo de la solicitud no es un JSON válido."];
  if (err.type === "entity.too.large") return [413, "Solicitud demasiado grande", "El contenido enviado supera el tamaño permitido."];
  switch (err.code) {
    case "23505": {
      const campo = CAMPOS_UNICOS[err.constraint] || "valor";
      return [409, "Registro duplicado", `Ya existe un registro con el mismo ${campo}.`];
    }
    case "23503":
      return [409, "Operación no permitida", "El registro está relacionado con otros datos."];
    case "23502":
      return [400, "Datos inválidos", "Falta un campo obligatorio."];
    case "22P02":
    case "22003":
    case "22007":
    case "22008":
      return [400, "Datos inválidos", "Uno de los valores no tiene el formato esperado."];
    default:
      return null;
  }
}

function manejadorErrores(err, req, res, _next) {
  const conocida = respuestaPara(err);
  if (conocida) {
    const [status, error, glosa] = conocida;
    return res.status(status).json({ error, glosa });
  }
  const referencia = crypto.randomUUID().slice(0, 8);
  // Se registra el detalle técnico sin datos del cuerpo de la solicitud
  console.error(`[${referencia}] ${req.method} ${req.originalUrl} -> ${err.code || ""} ${err.message}`);
  return res.status(500).json({
    error: "Error interno",
    glosa: `Ocurrió un error inesperado. Código de referencia: ${referencia}.`,
  });
}

function rutaNoEncontrada(req, res) {
  res.status(404).json({ error: "No encontrado", glosa: "El recurso solicitado no existe." });
}

// Los identificadores de la URL deben ser enteros positivos
function validarId(req, res, next, id) {
  if (!/^[1-9]\d{0,17}$/.test(String(id))) {
    return res.status(400).json({ error: "Datos inválidos", glosa: "El identificador no es válido." });
  }
  return next();
}

module.exports = { manejadorErrores, rutaNoEncontrada, validarId };
