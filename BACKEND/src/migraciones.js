// Ejecutor de migraciones de base de datos (NFR-DIS-2: migraciones seguras).
// Aplica en orden los archivos de sql/migraciones que aún no se han aplicado y
// registra cada uno en la tabla schema_migraciones. Cada migración corre en una
// transacción: si falla, no deja cambios parciales.
const fs = require("fs");
const path = require("path");

const CARPETA = path.join(__dirname, "..", "sql", "migraciones");

async function migrar(pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migraciones (
    nombre text PRIMARY KEY, aplicada_en timestamptz NOT NULL DEFAULT now())`);
  const aplicadas = new Set((await pool.query("SELECT nombre FROM schema_migraciones")).rows.map((r) => r.nombre));
  const archivos = fs.readdirSync(CARPETA).filter((f) => /^\d{3}_.*\.(sql|js)$/.test(f)).sort();
  for (const archivo of archivos) {
    if (aplicadas.has(archivo)) continue;
    const cliente = await pool.connect();
    try {
      await cliente.query("BEGIN");
      if (archivo.endsWith(".sql")) {
        await cliente.query(fs.readFileSync(path.join(CARPETA, archivo), "utf8"));
      } else {
        await require(path.join(CARPETA, archivo))(cliente);
      }
      await cliente.query("INSERT INTO schema_migraciones (nombre) VALUES ($1)", [archivo]);
      await cliente.query("COMMIT");
      console.log(`Migración aplicada: ${archivo}`);
    } catch (err) {
      await cliente.query("ROLLBACK");
      throw new Error(`La migración ${archivo} falló: ${err.message}`);
    } finally {
      cliente.release();
    }
  }
}

// DEF-19: cuenta de la API con privilegios mínimos.
// - Puede leer y escribir datos de negocio, pero no crear ni modificar tablas.
// - No puede modificar ni borrar la auditoría (RF-6.1: el registro no se puede
//   modificar ni borrar desde la aplicación).
// Se ejecuta en cada despliegue, por lo que también aplica una rotación de contraseña.
async function asegurarUsuarioAplicacion(pool) {
  const usuario = process.env.APP_DB_USER || "atlas_app";
  const clave = process.env.APP_DB_PASSWORD;
  if (!clave) return;
  if (!/^[a-z_][a-z0-9_]{2,40}$/.test(usuario)) throw new Error("APP_DB_USER no es un identificador válido");
  const cliente = await pool.connect();
  try {
    await cliente.query("BEGIN");
    const existe = await cliente.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [usuario]);
    const accion = existe.rows.length ? "ALTER" : "CREATE";
    await cliente.query(`${accion} ROLE ${usuario} WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD ${cliente.escapeLiteral(clave)}`);
    const db = (await cliente.query("SELECT current_database() AS d")).rows[0].d;
    await cliente.query(`GRANT CONNECT ON DATABASE ${cliente.escapeIdentifier(db)} TO ${usuario}`);
    await cliente.query(`GRANT USAGE ON SCHEMA public TO ${usuario}`);
    await cliente.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${usuario}`);
    await cliente.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${usuario}`);
    await cliente.query(`REVOKE UPDATE, DELETE, TRUNCATE ON auditoria FROM ${usuario}`);
    await cliente.query(`REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON schema_migraciones FROM ${usuario}`);
    await cliente.query("COMMIT");
    console.log(`Cuenta de la aplicación "${usuario}" actualizada con privilegios mínimos.`);
  } catch (err) {
    await cliente.query("ROLLBACK");
    throw err;
  } finally {
    cliente.release();
  }
}

module.exports = { migrar, asegurarUsuarioAplicacion };

if (require.main === module) {
  const { pool } = require("./db");
  migrar(pool)
    .then(() => asegurarUsuarioAplicacion(pool))
    .then(() => { console.log("Migraciones al día."); return pool.end(); })
    .catch((e) => { console.error(e.message); process.exit(1); });
}
