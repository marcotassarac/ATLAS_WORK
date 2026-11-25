const { Pool } = require("pg");
const { DATABASE_URL } = require("./config");

// DEF-01: la cadena de conexión ya no tiene un valor por defecto con credenciales.
const pool = new Pool({ connectionString: DATABASE_URL });

module.exports = { pool };
