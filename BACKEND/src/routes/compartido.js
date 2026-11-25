// Descarga pública de un documento mediante un enlace firmado (RF-5.5).
// DEF-15: la ruta no requiere sesión, pero solo entrega el documento del contrato y de
// la empresa indicados en el enlace, y solo mientras el enlace esté vigente.
const express = require("express");
const { pool } = require("../db");
const { verificarEnlace } = require("../enlaces");
const { registrarAuditoria } = require("../auditoria");

const router = express.Router();

router.get("/:token", async (req, res, next) => {
  const datos = verificarEnlace(req.params.token);
  if (!datos) {
    return res.status(403).json({ error: "Enlace no válido", glosa: "El enlace no es válido o ya venció." });
  }
  try {
    const doc = await pool.query(
      `SELECT d.document, d.nombre_archivo, d.tipo_mime
         FROM documentos_contrato d
         JOIN contratos c ON c.id = d.contract_id
         JOIN clientes cl ON cl.id = c.cliente_id
        WHERE d.contract_id = $1 AND cl.empresa_id = $2
        ORDER BY d.id DESC LIMIT 1`,
      [datos.contratoId, datos.empresaId]
    );
    if (!doc.rows.length) return res.status(404).json({ error: "No encontrado" });
    const { document: buffer, nombre_archivo, tipo_mime } = doc.rows[0];
    await registrarAuditoria(
      pool,
      { nombreUsuario: "enlace-compartido", empresaId: datos.empresaId },
      `DOCUMENTOS_DESCARGAR: descarga con enlace compartido del contrato ID ${datos.contratoId}`
    );
    res.setHeader("Content-Type", tipo_mime || "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(nombre_archivo || "contrato.pdf")}`);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.send(buffer);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
