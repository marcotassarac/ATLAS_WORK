-- DEF-11 (RF-5.2): metadatos de cada documento para entregarlo con su tipo real
-- y verificar su integridad (huella SHA-256).
ALTER TABLE documentos_contrato
  ADD COLUMN IF NOT EXISTS nombre_archivo text,
  ADD COLUMN IF NOT EXISTS tipo_mime text,
  ADD COLUMN IF NOT EXISTS tamano integer,
  ADD COLUMN IF NOT EXISTS sha256 text;
UPDATE documentos_contrato
   SET nombre_archivo = COALESCE(nombre_archivo, 'contrato.pdf'),
       tipo_mime = COALESCE(tipo_mime, 'application/pdf'),
       tamano = COALESCE(tamano, octet_length(document)),
       sha256 = COALESCE(sha256, encode(digest(document, 'sha256'), 'hex'));
