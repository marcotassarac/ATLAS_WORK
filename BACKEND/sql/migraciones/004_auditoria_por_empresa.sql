-- DEF-12 (RF-6.1): cada registro de auditoría queda asociado a su empresa, para que
-- cada administrador vea solo la auditoría de su empresa.
ALTER TABLE auditoria ADD COLUMN IF NOT EXISTS empresa_id bigint REFERENCES empresas(id);
UPDATE auditoria a
   SET empresa_id = (SELECT eu.empresa_id
                       FROM usuarios u JOIN empresa_usuarios eu ON eu.usuario_id = u.id
                      WHERE u.nombre_usuario = a.usuario_id
                      ORDER BY eu.id LIMIT 1)
 WHERE a.empresa_id IS NULL;
CREATE INDEX IF NOT EXISTS auditoria_empresa_idx ON auditoria (empresa_id, id DESC);
