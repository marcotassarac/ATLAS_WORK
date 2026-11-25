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

module.exports = { migrar };

if (require.main === module) {
  const { pool } = require("./db");
  migrar(pool)
    .then(() => { console.log("Migraciones al día."); return pool.end(); })
    .catch((e) => { console.error(e.message); process.exit(1); });
}
