const express = require("express");
const { pool } = require("../db");
const { validarId } = require("../errores");
const { validarCliente, validarContrato, validarEmpresa, validarUsuarioNuevo, Validador, hayErrores, responderErrores } = require("../validacion");
const { soloAdministrador } = require("../middleware/autorizacion");
const { erroresPolitica, mensajePolitica, hashear } = require("../seguridad/contrasenas");

const router = express.Router();
router.param("id", validarId); // DEF-10: id numérico o 400

// Crear relación empresa-usuario con rol (crea usuario si no existe)
router.post("/", soloAdministrador, async (req, res, next) => {
  try {
    const authUser = req.usuario;

    const empresaId = authUser.empresaId;
    let usuarioId;
    const { usuario_id, rol_id, nombre_usuario, contrasena_hash, correo } =
      req.body;

    if (!rol_id) {
      return res.status(400).json({ error: "Datos inválidos", glosa: "El campo rol_id es requerido" });
    }
    // DEF-05: solo se pueden asignar los roles del catálogo (1 administrador, 2 editor)
    const rolValido = await pool.query("SELECT id FROM roles WHERE id = $1", [Number(rol_id)]);
    if (!rolValido.rows.length) {
      return res.status(400).json({ error: "Datos inválidos", glosa: "El rol indicado no existe." });
    }

    // DEF-06: ya no se acepta usuario_id. Vincular un usuario existente por su id
    // permitía incorporar (y ver) cuentas de otras empresas.
    if (usuario_id) {
      return res.status(400).json({ error: "Datos inválidos", glosa: "Solo se pueden crear usuarios nuevos para la empresa." });
    } else if (nombre_usuario && contrasena_hash && correo) {
      // DEF-09: formato del nombre de usuario y del correo
      const vu = validarUsuarioNuevo(req.body);
      if (hayErrores(vu.errores)) return responderErrores(res, vu.errores);
      // Crear usuario primero (DEF-03: política de contraseñas y hash bcrypt)
      const erroresClave = erroresPolitica(contrasena_hash);
      if (erroresClave.length) {
        return res.status(400).json({ error: "Contraseña insegura", glosa: mensajePolitica(erroresClave) });
      }
      const usuarioResult = await pool.query(
        "INSERT INTO usuarios (nombre_usuario, contrasena_hash, correo) VALUES ($1, $2, $3) RETURNING id, nombre_usuario, correo, created_at",
        [nombre_usuario, await hashear(contrasena_hash), correo]
      );
      usuarioId = usuarioResult.rows[0].id;
    } else {
      return res.status(400).json({
        error: "Datos inválidos",
        glosa:
          "Debe proporcionar usuario_id o los datos del usuario (nombre_usuario, contrasena_hash, correo)",
      });
    }

    // Validar que venga rol_id
    if (!rol_id) {
      return res.status(400).json({
        error: "Datos inválidos",
        glosa: "El campo rol_id es requerido",
      });
    }

    // Crear relación empresa-usuario
    const result = await pool.query(
      "INSERT INTO empresa_usuarios (empresa_id, usuario_id, rol_id) VALUES ($1, $2, $3) RETURNING *",
      [empresaId, usuarioId, rol_id]
    );

    await pool.query(
      "INSERT INTO auditoria (usuario_id, accion) VALUES ($1, $2)",
      [
        authUser.nombreUsuario,
        `EMPRESA_USUARIOS_CREAR: vinculó usuario ${usuarioId} a empresa ${empresaId} con rol ${rol_id}`,
      ]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// Listar usuarios de la empresa (filtrado por empresa del token)
router.get("/", async (req, res, next) => {
  try {
    const authUser = req.usuario;

    const empresaId = authUser.empresaId;

    // Obtener todos los usuarios de la empresa con la estructura solicitada
    const result = await pool.query(
      `
      SELECT 
        u.id,
        u.nombre_usuario,
        u.correo,
        eu.created_at,
        eu.rol_id,
        r.nombre AS rol_nombre
      FROM empresa_usuarios eu
      INNER JOIN usuarios u ON u.id = eu.usuario_id
      LEFT JOIN roles r ON r.id = eu.rol_id
      WHERE eu.empresa_id = $1
      ORDER BY eu.created_at DESC
    `,
      [empresaId]
    );

    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

// Obtener vínculo por id
router.get("/:id", async (req, res, next) => {
  try {
    const result = await pool.query(
      "SELECT * FROM empresa_usuarios WHERE id=$1 AND empresa_id=$2",
      [req.params.id, req.usuario.empresaId]
    );
    if (result.rows.length === 0)
      return res.status(404).json({ error: "No encontrado" });
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// Actualizar vínculo
router.put("/:id", soloAdministrador, async (req, res, next) => {
  // DEF-06: solo se puede cambiar el rol; la empresa y el usuario del vínculo no se modifican.
  const { rol_id } = req.body;
  try {
    // DEF-05: solo se pueden asignar los roles del catálogo (1 administrador, 2 editor)
    const rolValido = await pool.query("SELECT id FROM roles WHERE id = $1", [Number(rol_id)]);
    if (!rolValido.rows.length) {
      return res.status(400).json({ error: "Datos inválidos", glosa: "El rol indicado no existe." });
    }
    const result = await pool.query(
      "UPDATE empresa_usuarios SET rol_id=$1 WHERE id=$2 AND empresa_id=$3 RETURNING *",
      [rol_id, req.params.id, req.usuario.empresaId]
    );
    if (result.rows.length === 0)
      return res.status(404).json({ error: "No encontrado" });

    const authUser = req.usuario;
    await pool.query(
      "INSERT INTO auditoria (usuario_id, accion) VALUES ($1, $2)",
      [
        authUser.nombreUsuario,
        `EMPRESA_USUARIOS_ACTUALIZAR: actualizó vínculo ID ${req.params.id}`,
      ]
    );

    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// Eliminar vínculo
router.delete("/:id", soloAdministrador, async (req, res, next) => {
  try {
    const result = await pool.query(
      "DELETE FROM empresa_usuarios WHERE id=$1 AND empresa_id=$2 RETURNING *",
      [req.params.id, req.usuario.empresaId]
    );
    if (result.rows.length === 0)
      return res.status(404).json({ error: "No encontrado" });

    const authUser = req.usuario;
    await pool.query(
      "INSERT INTO auditoria (usuario_id, accion) VALUES ($1, $2)",
      [
        authUser.nombreUsuario,
        `EMPRESA_USUARIOS_ELIMINAR: eliminó vínculo ID ${req.params.id}`,
      ]
    );

    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
