// Catálogo de roles (administrador, editor).
// DEF-05: el catálogo es de solo lectura. Antes cualquier visitante podía crear,
// renombrar o eliminar roles (POST/PUT/DELETE /roles sin autenticación ni rol).
const express = require("express");
const { pool } = require("../db");

const router = express.Router();

router.get("/", async (req, res) => {
  try {
    const result = await pool.query("SELECT id, nombre FROM roles ORDER BY id");
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al listar roles", glosa: err.message || err.toString() });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const result = await pool.query("SELECT id, nombre FROM roles WHERE id=$1", [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: "No encontrado" });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al obtener rol", glosa: err.message || err.toString() });
  }
});

module.exports = router;
