const express = require("express");
const { pool, transaccion } = require("../db");
const { registrarAuditoria } = require("../auditoria");
const { validarId } = require("../errores");
const { validarCliente, validarContrato, validarEmpresa, validarUsuarioNuevo, Validador, hayErrores, responderErrores } = require("../validacion");
const { soloAdministrador } = require("../middleware/autorizacion");
const { esUltimoAdministrador } = require("../usuariosEmpresa");
const { erroresPolitica, mensajePolitica, hashear } = require("../seguridad/contrasenas");

const router = express.Router();
const vu_datos = (b) => validarUsuarioNuevo(b).datos;
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
    } else {
      return res.status(400).json({
        error: "Datos inválidos",
        glosa:
          "Debe proporcionar usuario_id o los datos del usuario (nombre_usuario, contrasena_hash, correo)",
      });
    }

    // DEF-12: usuario, vínculo con la empresa y auditoría en una sola transacción.
    // Antes, si fallaba el vínculo, quedaba un usuario creado sin empresa.
    const hash = await hashear(contrasena_hash);
    const result = await transaccion(async (db) => {
      const u = await db.query(
        "INSERT INTO usuarios (nombre_usuario, contrasena_hash, correo) VALUES ($1, $2, $3) RETURNING id",
        [vu_datos(req.body).nombre_usuario, hash, vu_datos(req.body).correo]
      );
      usuarioId = u.rows[0].id;
      const r = await db.query(
        "INSERT INTO empresa_usuarios (empresa_id, usuario_id, rol_id) VALUES ($1, $2, $3) RETURNING *",
        [empresaId, usuarioId, Number(rol_id)]
      );
      await registrarAuditoria(db, req.usuario, `EMPRESA_USUARIOS_CREAR: creó usuario ID ${usuarioId} con rol ${Number(rol_id)}`);
      return r;
    });

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
    // DEF-15: la empresa no puede quedar sin administrador
    const vinculo = await pool.query("SELECT usuario_id FROM empresa_usuarios WHERE id = $1 AND empresa_id = $2", [
      req.params.id,
      req.usuario.empresaId,
    ]);
    if (!vinculo.rows.length) return res.status(404).json({ error: "No encontrado" });
    if (Number(rol_id) !== 1 && (await esUltimoAdministrador(pool, req.usuario.empresaId, vinculo.rows[0].usuario_id))) {
      return res.status(409).json({ error: "Operación no permitida", glosa: "La empresa debe conservar al menos un administrador." });
    }
    // DEF-12: la operación y su registro de auditoría se guardan juntos (todo o nada)
    const result = await transaccion(async (db) => {
      const r = await db.query(
        "UPDATE empresa_usuarios SET rol_id=$1 WHERE id=$2 AND empresa_id=$3 RETURNING *",
        [rol_id, req.params.id, req.usuario.empresaId]
      );
      if (r.rows.length) await registrarAuditoria(db, req.usuario, `EMPRESA_USUARIOS_ACTUALIZAR: actualizó vínculo ID ${req.params.id}`);
      return r;
    });
    if (result.rows.length === 0)
      return res.status(404).json({ error: "No encontrado" });

    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// Eliminar vínculo
router.delete("/:id", soloAdministrador, async (req, res, next) => {
  try {
    // DEF-15: la empresa no puede quedar sin administrador
    const vinculo = await pool.query("SELECT usuario_id FROM empresa_usuarios WHERE id = $1 AND empresa_id = $2", [
      req.params.id,
      req.usuario.empresaId,
    ]);
    if (!vinculo.rows.length) return res.status(404).json({ error: "No encontrado" });
    if ((await esUltimoAdministrador(pool, req.usuario.empresaId, vinculo.rows[0].usuario_id))) {
      return res.status(409).json({ error: "Operación no permitida", glosa: "La empresa debe conservar al menos un administrador." });
    }
    // DEF-12: la operación y su registro de auditoría se guardan juntos (todo o nada)
    const result = await transaccion(async (db) => {
      const r = await db.query(
        "DELETE FROM empresa_usuarios WHERE id=$1 AND empresa_id=$2 RETURNING *",
        [req.params.id, req.usuario.empresaId]
      );
      if (r.rows.length) await registrarAuditoria(db, req.usuario, `EMPRESA_USUARIOS_ELIMINAR: eliminó vínculo ID ${req.params.id}`);
      return r;
    });
    if (result.rows.length === 0)
      return res.status(404).json({ error: "No encontrado" });

    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
