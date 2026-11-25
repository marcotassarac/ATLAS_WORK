-- DEF-03 (NFR-SEG-2): convierte a bcrypt las contraseñas guardadas en texto plano.
-- pgcrypto genera hashes $2a$ compatibles con bcryptjs. Solo se transforman los
-- valores que todavía no tienen formato bcrypt, por lo que la migración es idempotente.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
UPDATE usuarios
   SET contrasena_hash = crypt(contrasena_hash, gen_salt('bf', 12))
 WHERE contrasena_hash !~ '^\$2[aby]\$[0-9]{2}\$';
