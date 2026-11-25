// DEF-15: reglas sobre los usuarios de una empresa.

// Verdadero si el usuario es el único administrador de la empresa. Se usa para impedir
// que una empresa quede sin administrador al eliminar un usuario o cambiar su rol.
async function esUltimoAdministrador(db, empresaId, usuarioId) {
  const r = await db.query(
    `SELECT count(*) FILTER (WHERE r.nombre = 'administrador')::int AS admins,
            bool_or(eu.usuario_id = $2 AND r.nombre = 'administrador') AS es_admin
       FROM empresa_usuarios eu JOIN roles r ON r.id = eu.rol_id
      WHERE eu.empresa_id = $1`,
    [empresaId, Number(usuarioId)]
  );
  return Boolean(r.rows[0].es_admin) && r.rows[0].admins <= 1;
}

module.exports = { esUltimoAdministrador };
