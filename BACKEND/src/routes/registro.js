// Registro público de un usuario y su empresa (RF-2.1 a RF-2.3, NFR-SEG-8).
// DEF-04: es la única escritura pública de la API; todo lo demás exige autenticación.
// DEF-13: la operación es atómica y exige el consentimiento informado del titular.
const express = require("express");
const { transaccion } = require("../db");
const { registrarAuditoria } = require("../auditoria");
const { erroresPolitica, mensajePolitica, hashear } = require("../seguridad/contrasenas");
const { validarEmpresa, validarUsuarioNuevo, hayErrores, responderErrores } = require("../validacion");

const router = express.Router();

// Versión vigente de la política de privacidad publicada en /privacidad
const VERSION_POLITICA = "1.0-2026-11";

const prefijar = (p, e) => Object.fromEntries(Object.entries(e).map(([k, v]) => [p + k, v]));

router.post("/", async (req, res, next) => {
  if (!req.body || !req.body.usuario || !req.body.empresa) {
    return res.status(400).json({ error: "Datos inválidos", glosa: "Debe enviar los datos del usuario y de la empresa." });
  }
  // DEF-13: consentimiento expreso (Ley 21.719). Sin él no se guarda ningún dato personal.
  if (req.body.acepta_politica !== true) {
    return res.status(400).json({
      error: "Consentimiento requerido",
      glosa: "Para crear la cuenta debe leer y aceptar la política de privacidad.",
      campos: { acepta_politica: "debe aceptar la política de privacidad" },
    });
  }
  // DEF-09: validación de los datos del usuario y de la empresa
  const vu = validarUsuarioNuevo(req.body.usuario);
  const ve = validarEmpresa(req.body.empresa);
  const errores = { ...prefijar("usuario.", vu.errores), ...prefijar("empresa.", ve.errores) };
  if (hayErrores(errores)) return responderErrores(res, errores);
  // DEF-03: política de contraseñas (ERS 2.4)
  const { contrasena_hash: contrasena } = req.body.usuario;
  const erroresClave = erroresPolitica(contrasena);
  if (erroresClave.length) {
    return res.status(400).json({ error: "Contraseña insegura", glosa: mensajePolitica(erroresClave) });
  }

  try {
    const hash = await hashear(contrasena);
    // DEF-13 (RF-2.2): usuario, empresa, rol y auditoría en una sola transacción.
    // Antes, si fallaba la empresa (por ejemplo, correo duplicado), el usuario ya
    // había quedado creado sin empresa.
    const resultado = await transaccion(async (db) => {
      const u = await db.query(
        `INSERT INTO usuarios (nombre_usuario, contrasena_hash, correo, acepta_politica_en, version_politica)
         VALUES ($1, $2, $3, now(), $4) RETURNING id, nombre_usuario, correo, created_at`,
        [vu.datos.nombre_usuario, hash, vu.datos.correo, VERSION_POLITICA]
      );
      const e = await db.query(
        "INSERT INTO empresas (nombre, direccion, telefono, correo) VALUES ($1, $2, $3, $4) RETURNING *",
        [ve.datos.nombre, ve.datos.direccion, ve.datos.telefono, ve.datos.correo]
      );
      // RF-2.3: el primer usuario de la empresa es administrador (se busca por nombre, no por id fijo)
      await db.query(
        "INSERT INTO empresa_usuarios (empresa_id, usuario_id, rol_id) SELECT $1, $2, id FROM roles WHERE nombre = 'administrador'",
        [e.rows[0].id, u.rows[0].id]
      );
      await registrarAuditoria(
        db,
        { nombreUsuario: u.rows[0].nombre_usuario, empresaId: e.rows[0].id },
        `REGISTRO: creó la empresa ID ${e.rows[0].id} y aceptó la política de privacidad ${VERSION_POLITICA}`
      );
      return { usuario: u.rows[0], empresa: e.rows[0] };
    });
    res.status(201).json(resultado);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
