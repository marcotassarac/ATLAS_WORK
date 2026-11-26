// DEF-18 (NFR-SEG-3): cifra los datos bancarios guardados antes de esta versión.
// Es idempotente: solo procesa los valores que todavía no tienen el prefijo "enc:v1:".
const path = require("path");
const { cifrar, estaCifrado } = require(path.join(__dirname, "..", "..", "src", "seguridad", "cifrado"));

module.exports = async function migrar(db) {
  const { rows } = await db.query(
    "SELECT id, numero_cuenta, titular_cuenta FROM clientes WHERE numero_cuenta IS NOT NULL OR titular_cuenta IS NOT NULL"
  );
  for (const r of rows) {
    const numero = r.numero_cuenta && !estaCifrado(r.numero_cuenta) ? cifrar(r.numero_cuenta) : r.numero_cuenta;
    const titular = r.titular_cuenta && !estaCifrado(r.titular_cuenta) ? cifrar(r.titular_cuenta) : r.titular_cuenta;
    if (numero !== r.numero_cuenta || titular !== r.titular_cuenta) {
      await db.query("UPDATE clientes SET numero_cuenta = $1, titular_cuenta = $2 WHERE id = $3", [numero, titular, r.id]);
    }
  }
};
