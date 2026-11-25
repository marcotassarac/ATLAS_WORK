// Gestión de clientes (RF-4). Todas las consultas filtran por la empresa de la sesión.
const express = require("express");
const { pool, transaccion } = require("../db");
const { validarId } = require("../errores");
const { validarCliente, hayErrores, responderErrores } = require("../validacion");
const { soloAdministrador } = require("../middleware/autorizacion");
const { registrarAuditoria } = require("../auditoria");

const router = express.Router();
router.param("id", validarId); // DEF-10: id numérico o 400

// Campos editables del cliente. Se usan para construir INSERT y UPDATE con
// parámetros ($1, $2, ...), nunca concatenando valores del usuario.
const CAMPOS = [
  "nombre", "correo", "telefono", "direccion", "es_empresa", "nombre_banco", "numero_cuenta", "titular_cuenta",
  "rut", "nombre_fantasia", "giro_actividad_economica",
  "nombre_representante", "cargo_representante", "correo_representante", "telefono_representante", "relacion_representante",
  "direccion_calle", "direccion_numero", "direccion_ciudad", "direccion_region", "sitio_web", "telefono_corporativo",
  "metodo_pago", "dia_pago", "moneda",
];
const valores = (datos) => CAMPOS.map((c) => datos[c]);

// Crear cliente
router.post("/", soloAdministrador, async (req, res, next) => {
  // DEF-09: validación y normalización de todos los campos (RF-4.3)
  const { datos, errores } = validarCliente(req.body);
  if (hayErrores(errores)) return responderErrores(res, errores);
  try {
    const cliente = await transaccion(async (db) => {
      const marcadores = CAMPOS.map((_, i) => `$${i + 1}`).join(", ");
      const r = await db.query(
        `INSERT INTO clientes (${CAMPOS.join(", ")}, empresa_id) VALUES (${marcadores}, $${CAMPOS.length + 1}) RETURNING *`,
        [...valores(datos), req.usuario.empresaId]
      );
      // DEF-12: la auditoría se guarda en la misma transacción que la operación
      await registrarAuditoria(db, req.usuario, `CLIENTES_CREAR: creó cliente ID ${r.rows[0].id}`);
      return r.rows[0];
    });
    res.status(201).json(cliente);
  } catch (err) {
    next(err);
  }
});

// DEF-14: los clientes eliminados (baja lógica) no se muestran en ninguna consulta
const VIGENTE = "eliminado_en IS NULL";

// Listar clientes de la empresa. DEF-14 (RF-4.2): paginación opcional con
// ?pagina=1&limite=20 y total de registros en la cabecera X-Total-Count.
router.get("/", async (req, res, next) => {
  try {
    const { pagina, limite } = req.query;
    const empresaId = req.usuario.empresaId;
    const total = await pool.query(`SELECT count(*)::int AS n FROM clientes WHERE empresa_id = $1 AND ${VIGENTE}`, [empresaId]);
    res.set("X-Total-Count", String(total.rows[0].n));
    if (pagina === undefined && limite === undefined) {
      const result = await pool.query(`SELECT * FROM clientes WHERE empresa_id = $1 AND ${VIGENTE} ORDER BY id DESC`, [empresaId]);
      return res.json(result.rows);
    }
    const p = Number(pagina || 1);
    const l = Number(limite || 20);
    if (!Number.isInteger(p) || p < 1 || !Number.isInteger(l) || l < 1 || l > 100) {
      return res.status(400).json({ error: "Datos inválidos", glosa: "pagina debe ser mayor o igual a 1 y limite entre 1 y 100." });
    }
    const result = await pool.query(
      `SELECT * FROM clientes WHERE empresa_id = $1 AND ${VIGENTE} ORDER BY id DESC LIMIT $2 OFFSET $3`,
      [empresaId, l, (p - 1) * l]
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

// Buscar clientes por nombre (consulta parametrizada; ILIKE no interpreta SQL)
router.get("/search", async (req, res, next) => {
  try {
    const nombre = String(req.query.name || "").slice(0, 100);
    const result = await pool.query(
      `SELECT * FROM clientes WHERE nombre ILIKE $1 AND empresa_id = $2 AND ${VIGENTE} ORDER BY nombre ASC`,
      [`%${nombre}%`, req.usuario.empresaId]
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

// Obtener cliente por id
router.get("/:id", async (req, res, next) => {
  try {
    const result = await pool.query(`SELECT * FROM clientes WHERE id=$1 AND empresa_id = $2 AND ${VIGENTE}`, [
      req.params.id,
      req.usuario.empresaId,
    ]);
    if (result.rows.length === 0) return res.status(404).json({ error: "No encontrado" });
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// Editar cliente (el empresa_id se mantiene; no se puede cambiar desde el cuerpo)
router.put("/:id", soloAdministrador, async (req, res, next) => {
  const { datos, errores } = validarCliente(req.body);
  if (hayErrores(errores)) return responderErrores(res, errores);
  try {
    const cliente = await transaccion(async (db) => {
      const asignaciones = CAMPOS.map((c, i) => `${c}=$${i + 1}`).join(", ");
      const n = CAMPOS.length;
      const r = await db.query(
        `UPDATE clientes SET ${asignaciones} WHERE id=$${n + 1} AND empresa_id=$${n + 2} AND ${VIGENTE} RETURNING *`,
        [...valores(datos), req.params.id, req.usuario.empresaId]
      );
      if (r.rows.length === 0) return null;
      await registrarAuditoria(db, req.usuario, `CLIENTES_ACTUALIZAR: actualizó cliente ID ${req.params.id}`);
      return r.rows[0];
    });
    if (!cliente) return res.status(404).json({ error: "No encontrado" });
    res.json(cliente);
  } catch (err) {
    next(err);
  }
});

// Eliminar cliente. DEF-14 (RF-4.2): baja lógica; el registro, su historial y sus
// contratos se conservan. La interfaz pide confirmación antes de llamar a esta ruta.
router.delete("/:id", soloAdministrador, async (req, res, next) => {
  try {
    const eliminado = await transaccion(async (db) => {
      const r = await db.query(`UPDATE clientes SET eliminado_en = now() WHERE id=$1 AND empresa_id = $2 AND ${VIGENTE} RETURNING id`, [
        req.params.id,
        req.usuario.empresaId,
      ]);
      if (r.rows.length === 0) return false;
      await registrarAuditoria(db, req.usuario, `CLIENTES_ELIMINAR: eliminó cliente ID ${req.params.id}`);
      return true;
    });
    if (!eliminado) return res.status(404).json({ error: "No encontrado" });
    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
