-- DEF-13 (NFR-SEG-8, Ley 21.719): evidencia del consentimiento para el tratamiento
-- de datos personales: fecha de aceptación y versión de la política aceptada.
ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS acepta_politica_en timestamptz,
  ADD COLUMN IF NOT EXISTS version_politica text;
