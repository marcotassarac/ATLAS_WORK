-- DEF-07 (RF-1.2): lista de tokens revocados al cerrar sesión.
-- Se guarda solo el identificador único del token (jti), nunca el token completo.
CREATE TABLE IF NOT EXISTS tokens_revocados (
  jti        uuid PRIMARY KEY,
  usuario_id bigint NOT NULL,
  expira_en  timestamptz NOT NULL,
  revocado_en timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tokens_revocados_expira_idx ON tokens_revocados (expira_en);
