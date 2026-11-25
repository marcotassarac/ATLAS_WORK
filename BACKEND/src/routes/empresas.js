const express = require("express");
const { pool } = require("../db");

const router = express.Router();

// Crear empresa adicional (usuario autenticado). El registro público está en /registro.
router.post("/", async (req, res) => {
  // Formato anterior: solo crear empresa
  const { nombre, direccion = null, telefono = null, correo } = req.body;
  try {
    const result = await pool.query(
      "INSERT INTO empresas (nombre, direccion, telefono, correo) VALUES ($1, $2, $3, $4) RETURNING *",
      [nombre, direccion, telefono, correo]
    );

    const authUser = req.usuario;
    await pool.query(
      "INSERT INTO auditoria (usuario_id, accion) VALUES ($1, $2)",
      [
        authUser.nombreUsuario,
        `EMPRESAS_CREAR: creó empresa ${nombre}`,
      ]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res
      .status(500)
      .json({
        error: "Error al crear empresa",
        glosa: err.message || err.toString(),
      });
  }
});

// Listar empresas
router.get("/", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM empresas ORDER BY id DESC");
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
    const result = await pool.query("SELECT * FROM empresas WHERE id=$1", [
      req.params.id,
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
router.put("/:id", async (req, res) => {
  const { nombre, direccion = null, telefono = null, correo } = req.body;
  try {
    const result = await pool.query(
      "UPDATE empresas SET nombre=$1, direccion=$2, telefono=$3, correo=$4 WHERE id=$5 RETURNING *",
      [nombre, direccion, telefono, correo, req.params.id]
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

// Eliminar empresa
router.delete("/:id", async (req, res) => {
  try {
    const result = await pool.query(
      "DELETE FROM empresas WHERE id=$1 RETURNING *",
      [req.params.id]
    );
    if (result.rows.length === 0)
      return res.status(404).json({ error: "No encontrado" });

    const authUser = req.usuario;
    await pool.query(
      "INSERT INTO auditoria (usuario_id, accion) VALUES ($1, $2)",
      [
        authUser.nombreUsuario,
        `EMPRESAS_ELIMINAR: eliminó empresa ID ${req.params.id}`,
      ]
    );

    res.json({ deleted: true });
  } catch (err) {
    console.error(err);
    res
      .status(500)
      .json({
        error: "Error al eliminar empresa",
        glosa: err.message || err.toString(),
      });
  }
});

module.exports = router;
