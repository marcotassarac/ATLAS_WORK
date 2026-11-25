const express = require("express");
const { pool } = require("../db");
const { soloAdministrador } = require("../middleware/autorizacion");

const router = express.Router();

// DEF-06: un usuario solo ve y modifica su propia empresa. Se eliminan POST /empresas
// (creaba empresas sin administrador) y DELETE /empresas/:id (no lo exige el ERS y
// permitía borrar empresas ajenas).

// Listar empresas (solo la propia)
router.get("/", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM empresas WHERE id = $1", [req.usuario.empresaId]);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res
      .status(500)
      .json({
        error: "Error al listar empresas",
        glosa: err.message || err.toString(),
      });
  }
});

// Obtener empresa por id
router.get("/:id", async (req, res) => {
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
    console.error(err);
    res
      .status(500)
      .json({
        error: "Error al obtener empresa",
        glosa: err.message || err.toString(),
      });
  }
});

// Actualizar empresa
router.put("/:id", soloAdministrador, async (req, res) => {
  const { nombre, direccion = null, telefono = null, correo } = req.body;
  try {
    const result = await pool.query(
      "UPDATE empresas SET nombre=$1, direccion=$2, telefono=$3, correo=$4 WHERE id=$5 AND id=$6 RETURNING *",
      [nombre, direccion, telefono, correo, req.params.id, req.usuario.empresaId]
    );
    if (result.rows.length === 0)
      return res.status(404).json({ error: "No encontrado" });

    const authUser = req.usuario;
    await pool.query(
      "INSERT INTO auditoria (usuario_id, accion) VALUES ($1, $2)",
      [
        authUser.nombreUsuario,
        `EMPRESAS_ACTUALIZAR: actualizó empresa ID ${req.params.id}`,
      ]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res
      .status(500)
      .json({
        error: "Error al actualizar empresa",
        glosa: err.message || err.toString(),
      });
  }
});

module.exports = router;
