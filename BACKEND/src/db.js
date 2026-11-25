const { Pool } = require("pg");
const { DATABASE_URL } = require("./config");

// DEF-01: la cadena de conexión ya no tiene un valor por defecto con credenciales.
const pool = new Pool({ connectionString: DATABASE_URL });

// DEF-12: ejecuta varias consultas como una sola unidad (todo o nada).
// Se usa para que cada operación y su registro de auditoría se guarden juntos.
async function transaccion(fn) {
  const cliente = await pool.connect();
  try {
    await cliente.query("BEGIN");
    const resultado = await fn(cliente);
    await cliente.query("COMMIT");
    return resultado;
  } catch (err) {
    await cliente.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    cliente.release();
  }
}

module.exports = { pool, transaccion };
