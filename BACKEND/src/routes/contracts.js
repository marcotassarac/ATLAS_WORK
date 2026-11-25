const path = require("path");
const fs = require("fs");
const express = require("express");
const multer = require("multer");
const { pool } = require("../db");
const { validarId } = require("../errores");
const { validarCliente, validarContrato, validarEmpresa, validarUsuarioNuevo, Validador, hayErrores, responderErrores } = require("../validacion");
const { soloAdministrador } = require("../middleware/autorizacion");

const router = express.Router();
router.param("id", validarId); // DEF-10: id numérico o 400


const storage = multer.memoryStorage();
const upload = multer({ storage });

// DEF-06: condición que asegura que el contrato pertenece a la empresa de la sesión
// (los contratos se relacionan con la empresa a través de su cliente).
const CONTRATO_DE_MI_EMPRESA =
  "EXISTS (SELECT 1 FROM clientes cl WHERE cl.id = contratos.cliente_id AND cl.empresa_id = $EMP)";

async function clienteDeMiEmpresa(clienteId, empresaId) {
  const r = await pool.query("SELECT 1 FROM clientes WHERE id = $1 AND empresa_id = $2", [Number(clienteId), empresaId]);
  return r.rows.length > 0;
}

// Crear contrato con archivo PDF (guardado en DB como bytea)
router.post("/", soloAdministrador, upload.single("file"), async (req, res, next) => {
  // DEF-09: validación de cliente, título, descripción y fechas
  const { datos, errores } = validarContrato(req.body);
  if (hayErrores(errores)) return responderErrores(res, errores);
  const { cliente_id, titulo, descripcion, fecha_inicio, fecha_fin } = datos;
  try {
    // DEF-06 / RB-3: el cliente del contrato debe ser de la empresa de la sesión
    if (!(await clienteDeMiEmpresa(cliente_id, req.usuario.empresaId))) {
      return res.status(404).json({ error: "No encontrado", glosa: "El cliente no existe en su empresa." });
    }
    const clientIdNum = Number(cliente_id);
    const contractInsert = await pool.query(
      "INSERT INTO contratos (cliente_id, titulo, descripcion, fecha_inicio, fecha_fin) VALUES ($1, $2, $3, $4, $5) RETURNING *",
      [clientIdNum, titulo, descripcion, fecha_inicio, fecha_fin]
    );

    if (req.file && req.file.buffer) {
      await pool.query(
        "INSERT INTO documentos_contrato (contract_id, document) VALUES ($1, $2)",
        [contractInsert.rows[0].id, req.file.buffer]
      );
    }

    const result = contractInsert;
    const authUser = req.usuario;
    await pool.query(
      "INSERT INTO auditoria (usuario_id, accion) VALUES ($1, $2)",
      [
        authUser.nombreUsuario,
        `CONTRATOS_CREAR: creó contrato ${titulo} para cliente ${cliente_id}`,
      ]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// Listar contratos
router.get("/", async (req, res, next) => {
  try {
    const authUser = req.usuario;
    const empresaId = authUser.empresaId;
    const result = await pool.query(
      `
      SELECT 
        c.id, 
        c.titulo, 
        c.descripcion, 
        c.fecha_inicio, 
        c.fecha_fin, 
        c.created_at,
        cl.nombre AS cliente_nombre
      FROM contratos c
      INNER JOIN clientes cl ON cl.id = c.cliente_id
      WHERE cl.empresa_id = $1
      ORDER BY c.id DESC
    `,
      [empresaId]
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

// Servicio 1: Contratos por estado (por_vencer y vencido)
router.get("/estados", async (req, res, next) => {
  try {
    const authUser = req.usuario;

    const empresaId = authUser.empresaId;
    const hoy = new Date();
    const hoyFormateado = hoy.toISOString().split("T")[0]; // YYYY-MM-DD
    const fecha30Dias = new Date(hoy);
    fecha30Dias.setDate(fecha30Dias.getDate() + 30);
    const fecha30DiasFormateada = fecha30Dias.toISOString().split("T")[0];

    // Contratos por vencer (fecha_fin entre hoy y 30 días)
    const porVencer = await pool.query(
      `SELECT c.id, c.cliente_id, c.titulo, c.descripcion, c.fecha_inicio, c.fecha_fin, c.created_at
       FROM contratos c
       INNER JOIN clientes cl ON cl.id = c.cliente_id
       WHERE cl.empresa_id = $1 
         AND c.fecha_fin >= $2 
         AND c.fecha_fin <= $3
       ORDER BY c.fecha_fin ASC
       LIMIT 3`,
      [empresaId, hoyFormateado, fecha30DiasFormateada]
    );

    // Contratos vencidos (fecha_fin ya pasó)
    const vencidos = await pool.query(
      `SELECT c.id, c.cliente_id, c.titulo, c.descripcion, c.fecha_inicio, c.fecha_fin, c.created_at
       FROM contratos c
       INNER JOIN clientes cl ON cl.id = c.cliente_id
       WHERE cl.empresa_id = $1 
         AND c.fecha_fin < $2
       ORDER BY c.fecha_fin DESC
       LIMIT 3`,
      [empresaId, hoyFormateado]
    );

    // Agregar estado a cada contrato
    const porVencerConEstado = porVencer.rows.map((contrato) => ({
      ...contrato,
      estado: "por_vencer",
    }));

    const vencidosConEstado = vencidos.rows.map((contrato) => ({
      ...contrato,
      estado: "vencido",
    }));

    res.json([...porVencerConEstado, ...vencidosConEstado]);
  } catch (err) {
    next(err);
  }
});

// Servicio 2: Dashboard con estadísticas de la empresa
router.get("/dashboard", async (req, res, next) => {
  try {
    const authUser = req.usuario;

    const empresaId = authUser.empresaId;
    const hoy = new Date();
    const hoyFormateado = hoy.toISOString().split("T")[0];

    // Fechas para los próximos 7, 15 y 30 días
    const fecha7Dias = new Date(hoy);
    fecha7Dias.setDate(fecha7Dias.getDate() + 7);
    const fecha7DiasFormateada = fecha7Dias.toISOString().split("T")[0];

    const fecha15Dias = new Date(hoy);
    fecha15Dias.setDate(fecha15Dias.getDate() + 15);
    const fecha15DiasFormateada = fecha15Dias.toISOString().split("T")[0];

    const fecha30Dias = new Date(hoy);
    fecha30Dias.setDate(fecha30Dias.getDate() + 30);
    const fecha30DiasFormateada = fecha30Dias.toISOString().split("T")[0];

    // Total de usuarios de la empresa
    const totalUsuariosResult = await pool.query(
      "SELECT COUNT(*) as total FROM empresa_usuarios WHERE empresa_id = $1",
      [empresaId]
    );
    const totalUsuarios = parseInt(totalUsuariosResult.rows[0].total);

    // Total de clientes asociados a la empresa
    const totalClientesResult = await pool.query(
      "SELECT COUNT(*) as total FROM clientes WHERE empresa_id = $1",
      [empresaId]
    );
    const totalClientes = parseInt(totalClientesResult.rows[0].total);

    // Total de contratos que vencen en los próximos 7 días
    const contratos7DiasResult = await pool.query(
      `SELECT COUNT(*) as total 
       FROM contratos c
       INNER JOIN clientes cl ON cl.id = c.cliente_id
       WHERE cl.empresa_id = $1 
         AND c.fecha_fin >= $2 
         AND c.fecha_fin <= $3`,
      [empresaId, hoyFormateado, fecha7DiasFormateada]
    );
    const contratos7Dias = parseInt(contratos7DiasResult.rows[0].total);

    // Total de contratos que vencen en los próximos 15 días
    const contratos15DiasResult = await pool.query(
      `SELECT COUNT(*) as total 
       FROM contratos c
       INNER JOIN clientes cl ON cl.id = c.cliente_id
       WHERE cl.empresa_id = $1 
         AND c.fecha_fin >= $2 
         AND c.fecha_fin <= $3`,
      [empresaId, hoyFormateado, fecha15DiasFormateada]
    );
    const contratos15Dias = parseInt(contratos15DiasResult.rows[0].total);

    // Total de contratos que vencen en los próximos 30 días
    const contratos30DiasResult = await pool.query(
      `SELECT COUNT(*) as total 
       FROM contratos c
       INNER JOIN clientes cl ON cl.id = c.cliente_id
       WHERE cl.empresa_id = $1 
         AND c.fecha_fin >= $2 
         AND c.fecha_fin <= $3`,
      [empresaId, hoyFormateado, fecha30DiasFormateada]
    );
    const contratos30Dias = parseInt(contratos30DiasResult.rows[0].total);

    res.json({
      totalUsuarios,
      totalClientes,
      contratosVencen7Dias: contratos7Dias,
      contratosVencen15Dias: contratos15Dias,
      contratosVencen30Dias: contratos30Dias,
    });
  } catch (err) {
    next(err);
  }
});

// Obtener contrato por id
router.get("/:id", async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT id, cliente_id, titulo, descripcion, fecha_inicio, fecha_fin, created_at FROM contratos
        WHERE id=$1 AND ${CONTRATO_DE_MI_EMPRESA.replace("$EMP", "$2")}`,
      [req.params.id, req.usuario.empresaId]
    );
    if (result.rows.length === 0)
      return res.status(404).json({ error: "No encontrado" });
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// Actualizar contrato
router.put("/:id", soloAdministrador, upload.single("file"), async (req, res, next) => {
  try {
    const authUser = req.usuario;

    const empresaId = authUser.empresaId;
    const contratoId = req.params.id;

    // Verificar que el contrato pertenezca a la empresa del token
    const contratoExistente = await pool.query(
      `SELECT c.id, c.cliente_id, c.titulo
       FROM contratos c
       INNER JOIN clientes cl ON cl.id = c.cliente_id
       WHERE c.id = $1 AND cl.empresa_id = $2`,
      [contratoId, empresaId]
    );

    if (contratoExistente.rows.length === 0) {
      return res.status(404).json({
        error: "No encontrado",
        glosa: "Contrato no encontrado o no pertenece a tu empresa",
      });
    }

    // DEF-09: validación parcial (solo los campos enviados)
    const { datos, errores } = validarContrato(req.body, { parcial: true });
    if (hayErrores(errores)) return responderErrores(res, errores);
    const { cliente_id, titulo, descripcion, fecha_inicio, fecha_fin } = datos;

    // Construir la consulta dinámicamente solo con los campos que se envían
    const updates = [];
    const values = [];
    let paramIndex = 1;

    if (cliente_id !== undefined && !(await clienteDeMiEmpresa(cliente_id, empresaId))) {
      return res.status(404).json({ error: "No encontrado", glosa: "El cliente no existe en su empresa." });
    }
    if (cliente_id !== undefined) {
      updates.push(`cliente_id = $${paramIndex}`);
      values.push(Number(cliente_id));
      paramIndex++;
    }

    if (titulo !== undefined) {
      updates.push(`titulo = $${paramIndex}`);
      values.push(titulo);
      paramIndex++;
    }

    if (descripcion !== undefined) {
      updates.push(`descripcion = $${paramIndex}`);
      values.push(descripcion);
      paramIndex++;
    }

    if (fecha_inicio !== undefined) {
      updates.push(`fecha_inicio = $${paramIndex}`);
      values.push(fecha_inicio);
      paramIndex++;
    }

    if (fecha_fin !== undefined) {
      updates.push(`fecha_fin = $${paramIndex}`);
      values.push(fecha_fin);
      paramIndex++;
    }

    // Si no hay campos para actualizar, retornar el contrato actual
    if (updates.length === 0) {
      const contratoActual = await pool.query(
        "SELECT * FROM contratos WHERE id = $1",
        [contratoId]
      );
      return res.json(contratoActual.rows[0]);
    }

    // Agregar el ID del contrato al final
    values.push(contratoId);
    const result = await pool.query(
      `UPDATE contratos 
       SET ${updates.join(", ")}
       WHERE id = $${paramIndex}
       RETURNING *`,
      values
    );

    // Si se envía un nuevo archivo, actualizarlo
    if (req.file && req.file.buffer) {
      // Insertar nuevo documento (manteniendo el historial)
      await pool.query(
        "INSERT INTO documentos_contrato (contract_id, document) VALUES ($1, $2)",
        [contratoId, req.file.buffer]
      );
    }

    // Registrar en auditoría
    await pool.query(
      "INSERT INTO auditoria (usuario_id, accion) VALUES ($1, $2)",
      [
        authUser.nombreUsuario,
        `CONTRATOS_ACTUALIZAR: actualizó contrato ID ${contratoId} - ${
          titulo || contratoExistente.rows[0].titulo
        }`,
      ]
    );

    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// Descargar/visualizar el último documento asociado al contrato
router.get("/:id/file", async (req, res, next) => {
  try {
    const doc = await pool.query(
      `SELECT d.document FROM documentos_contrato d
         JOIN contratos ON contratos.id = d.contract_id
        WHERE d.contract_id=$1 AND ${CONTRATO_DE_MI_EMPRESA.replace("$EMP", "$2")}
        ORDER BY d.id DESC LIMIT 1`,
      [req.params.id, req.usuario.empresaId]
    );
    if (doc.rows.length === 0)
      return res.status(404).json({ error: "Documento no encontrado" });
    const buffer = doc.rows[0].document;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", 'inline; filename="contrato.pdf"');
    res.send(buffer);
  } catch (err) {
    next(err);
  }
});

// Eliminar contrato y su archivo
router.delete("/:id", soloAdministrador, async (req, res, next) => {
  try {
    // DEF-06: primero se confirma que el contrato es de la empresa de la sesión
    const propio = await pool.query(
      `SELECT id FROM contratos WHERE id=$1 AND ${CONTRATO_DE_MI_EMPRESA.replace("$EMP", "$2")}`,
      [req.params.id, req.usuario.empresaId]
    );
    if (propio.rows.length === 0)
      return res.status(404).json({ error: "No encontrado" });
    await pool.query("DELETE FROM documentos_contrato WHERE contract_id=$1", [
      req.params.id,
    ]);
    const result = await pool.query(
      "DELETE FROM contratos WHERE id=$1 RETURNING *",
      [req.params.id]
    );

    const authUser = req.usuario;
    await pool.query(
      "INSERT INTO auditoria (usuario_id, accion) VALUES ($1, $2)",
      [
        authUser.nombreUsuario,
        `CONTRATOS_ELIMINAR: eliminó contrato ID ${req.params.id}`,
      ]
    );

    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
