// Catálogo de roles (administrador, editor).
// DEF-05: el catálogo es de solo lectura. Antes cualquier visitante podía crear,
// renombrar o eliminar roles (POST/PUT/DELETE /roles sin autenticación ni rol).
const express = require("express");
const { pool } = require("../db");
const { validarId } = require("../errores");

const router = express.Router();
router.param("id", validarId); // DEF-10: id numérico o 400

router.get("/", async (req, res, next) => {
  try {
    const result = await pool.query("SELECT id, nombre FROM roles ORDER BY id");
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const result = await pool.query("SELECT id, nombre FROM roles WHERE id=$1", [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: "No encontrado" });
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
