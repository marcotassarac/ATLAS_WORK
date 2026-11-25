const express = require("express");
const { pool } = require("../db");
const { validarId } = require("../errores");
const { validarCliente, validarContrato, validarEmpresa, validarUsuarioNuevo, Validador, hayErrores, responderErrores } = require("../validacion");
const { soloAdministrador } = require("../middleware/autorizacion");
const { erroresPolitica, mensajePolitica, hashear } = require("../seguridad/contrasenas");

const router = express.Router();
router.param("id", validarId); // DEF-10: id numérico o 400

// DEF-06: se elimina POST /usuarios, que creaba cuentas sin empresa. Los usuarios
// se crean dentro de la empresa con POST /empresa-usuarios.

// Condición reutilizable: el usuario pertenece a la empresa de la sesión
const EN_MI_EMPRESA = "EXISTS (SELECT 1 FROM empresa_usuarios eu WHERE eu.usuario_id = usuarios.id AND eu.empresa_id = $EMP)";

// Listar usuarios filtrados por empresa del token
router.get("/", async (req, res, next) => {
  try {
    const authUser = req.usuario;

    // Filtrar usuarios que pertenecen a la empresa del token
    const result = await pool.query(
      `SELECT DISTINCT u.id, u.nombre_usuario, u.correo, u.created_at 
       FROM usuarios u
       INNER JOIN empresa_usuarios eu ON eu.usuario_id = u.id
       WHERE eu.empresa_id = $1
       ORDER BY u.id DESC`,
      [authUser.empresaId]
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
    if (result.rows.length === 0)
      return res.status(404).json({ error: "No encontrado" });
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// Actualizar usuario
router.put("/:id", soloAdministrador, async (req, res, next) => {
  const { nombre_usuario, contrasena_hash, correo } = req.body;
  // DEF-09: si se envían, el nombre de usuario y el correo deben tener formato válido
  const v = new Validador(req.body);
  if (nombre_usuario !== undefined) v.usuario("nombre_usuario");
  if (correo !== undefined) v.correo("correo", { requerido: true });
  if (hayErrores(v.errores)) return responderErrores(res, v.errores);
  try {
    const erroresClave = contrasena_hash === undefined ? [] : erroresPolitica(contrasena_hash);
    if (erroresClave.length) {
      return res.status(400).json({ error: "Contraseña insegura", glosa: mensajePolitica(erroresClave) });
    }
    const result = await pool.query(
      `UPDATE usuarios SET nombre_usuario=$1, contrasena_hash=COALESCE($2, contrasena_hash), correo=$3
        WHERE id=$4 AND ${EN_MI_EMPRESA.replace("$EMP", "$5")} RETURNING id, nombre_usuario, correo, created_at`,
      [nombre_usuario, contrasena_hash === undefined ? null : await hashear(contrasena_hash), correo, req.params.id, req.usuario.empresaId]
    );
    if (result.rows.length === 0)
      return res.status(404).json({ error: "No encontrado" });

    const authUser = req.usuario;
    await pool.query(
      "INSERT INTO auditoria (usuario_id, accion) VALUES ($1, $2)",
      [
        authUser.nombreUsuario,
        `USUARIOS_ACTUALIZAR: actualizó usuario ID ${req.params.id}`,
      ]
    );

    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// Eliminar usuario
router.delete("/:id", soloAdministrador, async (req, res, next) => {
  try {
    const result = await pool.query(
      `DELETE FROM usuarios WHERE id=$1 AND ${EN_MI_EMPRESA.replace("$EMP", "$2")} RETURNING id`,
      [req.params.id, req.usuario.empresaId]
    );
    if (result.rows.length === 0)
      return res.status(404).json({ error: "No encontrado" });

    const authUser = req.usuario;
    await pool.query(
      "INSERT INTO auditoria (usuario_id, accion) VALUES ($1, $2)",
      [
        authUser.nombreUsuario,
        `USUARIOS_ELIMINAR: eliminó usuario ID ${req.params.id}`,
      ]
    );

    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
