// DEF-12: registro de auditoría generado solo por el servidor (RF-6.1, NFR-SEG-6).
// Cada registro guarda el usuario, la empresa, la fecha (por defecto en la base) y
// la acción. Se llama dentro de la misma transacción que la operación auditada.
async function registrarAuditoria(db, usuario, accion) {
  await db.query("INSERT INTO auditoria (usuario_id, empresa_id, accion) VALUES ($1, $2, $3)", [
    usuario.nombreUsuario,
    usuario.empresaId,
    String(accion).slice(0, 500),
  ]);
}

module.exports = { registrarAuditoria };
