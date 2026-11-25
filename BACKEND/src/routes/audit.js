// Consulta de auditoría (RF-6.1).
// DEF-12: se elimina POST /auditoria, que permitía a cualquier usuario escribir
// registros falsos. Los registros los genera solo el servidor (src/auditoria.js).
// Solo el administrador consulta la auditoría, y solo la de su empresa.
const express = require("express");
const { pool } = require("../db");
const { soloAdministrador } = require("../middleware/autorizacion");

const router = express.Router();

router.get("/", soloAdministrador, async (req, res, next) => {
  try {
    const result = await pool.query(
      "SELECT id, usuario_id, accion, fecha_hora FROM auditoria WHERE empresa_id = $1 ORDER BY id DESC LIMIT 1000",
      [req.usuario.empresaId]
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
