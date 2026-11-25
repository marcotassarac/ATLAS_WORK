-- DEF-14 (RF-4.2): eliminación lógica de clientes. El registro se conserva (con su
-- historial y contratos) y deja de mostrarse.
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS eliminado_en timestamptz;
-- El correo era único en toda la base: una empresa podía descubrir que otra ya tenía
-- registrado a un cliente (error al crearlo) y un correo eliminado no se podía reutilizar.
-- Ahora es único por empresa y solo entre clientes vigentes.
ALTER TABLE clientes DROP CONSTRAINT IF EXISTS clientes_correo_key;
CREATE UNIQUE INDEX IF NOT EXISTS clientes_empresa_correo_uidx
  ON clientes (empresa_id, correo) WHERE eliminado_en IS NULL;
CREATE INDEX IF NOT EXISTS clientes_empresa_vigentes_idx ON clientes (empresa_id, id DESC) WHERE eliminado_en IS NULL;
