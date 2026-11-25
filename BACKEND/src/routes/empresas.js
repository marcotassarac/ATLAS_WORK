const express = require("express");
const { pool, transaccion } = require("../db");
const { registrarAuditoria } = require("../auditoria");
const { validarId } = require("../errores");
const { validarCliente, validarContrato, validarEmpresa, validarUsuarioNuevo, Validador, hayErrores, responderErrores } = require("../validacion");
const { soloAdministrador } = require("../middleware/autorizacion");

const router = express.Router();
router.param("id", validarId); // DEF-10: id numérico o 400

// DEF-06: un usuario solo ve y modifica su propia empresa. Se eliminan POST /empresas
// (creaba empresas sin administrador) y DELETE /empresas/:id (no lo exige el ERS y
// permitía borrar empresas ajenas).

// Listar empresas (solo la propia)
router.get("/", async (req, res, next) => {
  try {
    const result = await pool.query("SELECT * FROM empresas WHERE id = $1", [req.usuario.empresaId]);
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

// Obtener empresa por id
router.get("/:id", async (req, res, next) => {
  try {
    if (Number(req.params.id) !== req.usuario.empresaId)
      return res.status(404).json({ error: "No encontrado" });
    const result = await pool.query("SELECT * FROM empresas WHERE id=$1", [
      req.usuario.empresaId,
    ]);
    if (result.rows.length === 0)
      return res.status(404).json({ error: "No encontrado" });
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// Actualizar empresa
router.put("/:id", soloAdministrador, async (req, res, next) => {
  // DEF-09: validación de los datos de la empresa
  const { datos, errores } = validarEmpresa(req.body);
  if (hayErrores(errores)) return responderErrores(res, errores);
  const { nombre, direccion, telefono, correo } = datos;
  try {
    // DEF-12: la operación y su registro de auditoría se guardan juntos (todo o nada)
    const result = await transaccion(async (db) => {
      const r = await db.query(
        "UPDATE empresas SET nombre=$1, direccion=$2, telefono=$3, correo=$4 WHERE id=$5 AND id=$6 RETURNING *",
        [nombre, direccion, telefono, correo, req.params.id, req.usuario.empresaId]
      );
      if (r.rows.length) await registrarAuditoria(db, req.usuario, `EMPRESAS_ACTUALIZAR: actualizó empresa ID ${req.params.id}`);
      return r;
    });
    if (result.rows.length === 0)
      return res.status(404).json({ error: "No encontrado" });

    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
