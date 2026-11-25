// Usuarios de la empresa (RF-3). Todas las consultas filtran por la empresa de la sesión.
const express = require("express");
const { pool, transaccion } = require("../db");
const { registrarAuditoria } = require("../auditoria");
const { validarId } = require("../errores");
const { Validador, hayErrores, responderErrores } = require("../validacion");
const { erroresPolitica, mensajePolitica, hashear } = require("../seguridad/contrasenas");
const { esUltimoAdministrador } = require("../usuariosEmpresa");

const router = express.Router();
router.param("id", validarId); // DEF-10: id numérico o 400

// DEF-06: se elimina POST /usuarios, que creaba cuentas sin empresa. Los usuarios
// se crean dentro de la empresa con POST /empresa-usuarios.

// Condición reutilizable: el usuario pertenece a la empresa de la sesión
const EN_MI_EMPRESA = "EXISTS (SELECT 1 FROM empresa_usuarios eu WHERE eu.usuario_id = usuarios.id AND eu.empresa_id = $EMP)";

const esAdministrador = (req) => req.usuario.rol === "administrador";
const esPropio = (req) => Number(req.params.id) === req.usuario.usuarioId;

// Listar usuarios de la empresa
router.get("/", async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT DISTINCT u.id, u.nombre_usuario, u.correo, u.created_at
         FROM usuarios u
         INNER JOIN empresa_usuarios eu ON eu.usuario_id = u.id
        WHERE eu.empresa_id = $1
        ORDER BY u.id DESC`,
      [req.usuario.empresaId]
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

// Obtener usuario por id
router.get("/:id", async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT id, nombre_usuario, correo, created_at FROM usuarios WHERE id = $1 AND ${EN_MI_EMPRESA.replace("$EMP", "$2")}`,
      [req.params.id, req.usuario.empresaId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: "No encontrado" });
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// Actualizar usuario.
// DEF-15: actualización parcial (solo los campos enviados). Antes la pantalla enviaba
// solo el correo y la consulta dejaba nombre_usuario en NULL (error 500).
// El administrador edita a los usuarios de su empresa; cada usuario puede editar su
// propia cuenta (correo y contraseña), incluido el editor.
router.put("/:id", async (req, res, next) => {
  if (!esAdministrador(req) && !esPropio(req)) {
    return res.status(403).json({ error: "Prohibido", glosa: "Solo puede modificar su propia cuenta." });
  }
  const { nombre_usuario, contrasena_hash, correo } = req.body;
  // DEF-09: si se envían, el nombre de usuario y el correo deben tener formato válido
  const v = new Validador(req.body);
  if (nombre_usuario !== undefined) v.usuario("nombre_usuario");
  if (correo !== undefined) v.correo("correo", { requerido: true });
  if (hayErrores(v.errores)) return responderErrores(res, v.errores);
  // DEF-03: política de contraseñas si se cambia la contraseña
  const erroresClave = contrasena_hash === undefined ? [] : erroresPolitica(contrasena_hash);
  if (erroresClave.length) {
    return res.status(400).json({ error: "Contraseña insegura", glosa: mensajePolitica(erroresClave) });
  }
  try {
    const hash = contrasena_hash === undefined ? null : await hashear(contrasena_hash);
    const result = await transaccion(async (db) => {
      const r = await db.query(
        `UPDATE usuarios
            SET nombre_usuario = COALESCE($1, nombre_usuario),
                correo = COALESCE($2, correo),
                contrasena_hash = COALESCE($3, contrasena_hash)
          WHERE id = $4 AND ${EN_MI_EMPRESA.replace("$EMP", "$5")}
          RETURNING id, nombre_usuario, correo, created_at`,
        [v.datos.nombre_usuario ?? null, v.datos.correo ?? null, hash, req.params.id, req.usuario.empresaId]
      );
      if (r.rows.length) {
        const que = hash ? "actualizó la contraseña del usuario" : "actualizó el usuario";
        await registrarAuditoria(db, req.usuario, `USUARIOS_ACTUALIZAR: ${que} ID ${req.params.id}`);
      }
      return r;
    });
    if (result.rows.length === 0) return res.status(404).json({ error: "No encontrado" });
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// Eliminar usuario de la empresa (RF-3.3).
// DEF-15: antes fallaba siempre (500) porque el vínculo empresa_usuarios impedía
// borrar la fila. Ahora se elimina el vínculo con la empresa y, si el usuario no
// pertenece a otra empresa, también su cuenta. Un administrador no puede eliminarse
// a sí mismo ni dejar a la empresa sin administradores.
router.delete("/:id", async (req, res, next) => {
  if (!esAdministrador(req)) {
    return res.status(403).json({ error: "Prohibido", glosa: "Su rol no permite realizar esta operación." });
  }
  if (esPropio(req)) {
    return res.status(409).json({ error: "Operación no permitida", glosa: "No puede eliminar su propia cuenta." });
  }
  try {
    const resultado = await transaccion(async (db) => {
      const empresaId = req.usuario.empresaId;
      const vinculo = await db.query(
        "SELECT id FROM empresa_usuarios WHERE usuario_id = $1 AND empresa_id = $2",
        [req.params.id, empresaId]
      );
      if (!vinculo.rows.length) return "no_encontrado";
      if (await esUltimoAdministrador(db, empresaId, req.params.id)) return "ultimo_admin";
      await db.query("DELETE FROM empresa_usuarios WHERE usuario_id = $1 AND empresa_id = $2", [req.params.id, empresaId]);
      const otras = await db.query("SELECT 1 FROM empresa_usuarios WHERE usuario_id = $1 LIMIT 1", [req.params.id]);
      if (!otras.rows.length) await db.query("DELETE FROM usuarios WHERE id = $1", [req.params.id]);
      await registrarAuditoria(db, req.usuario, `USUARIOS_ELIMINAR: eliminó usuario ID ${req.params.id}`);
      return "ok";
    });
    if (resultado === "no_encontrado") return res.status(404).json({ error: "No encontrado" });
    if (resultado === "ultimo_admin") {
      return res.status(409).json({ error: "Operación no permitida", glosa: "La empresa debe conservar al menos un administrador." });
    }
    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
