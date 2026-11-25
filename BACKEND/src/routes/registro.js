// Registro público de un usuario y su empresa (RF-2.1 a RF-2.3).
// DEF-04: se separa de /empresas para que sea la única escritura pública de la API;
// todo lo demás exige autenticación.
const express = require("express");
const { pool } = require("../db");
const { erroresPolitica, mensajePolitica, hashear } = require("../seguridad/contrasenas");

const router = express.Router();

router.post("/", async (req, res) => {
  if (!req.body || !req.body.usuario || !req.body.empresa) {
    return res.status(400).json({ error: "Datos inválidos", glosa: "Debe enviar los datos del usuario y de la empresa." });
  }
  const { usuario, empresa } = req.body;
  const { nombre_usuario, contrasena_hash, correo: correoUsuario } = usuario;
  const { nombre, direccion = null, telefono = null, correo } = empresa;

  try {
    const erroresClave = erroresPolitica(contrasena_hash);
    if (erroresClave.length) {
      return res.status(400).json({ error: "Contraseña insegura", glosa: mensajePolitica(erroresClave) });
    }
    // 1. Crear usuario
    const usuarioResult = await pool.query(
      "INSERT INTO usuarios (nombre_usuario, contrasena_hash, correo) VALUES ($1, $2, $3) RETURNING id, nombre_usuario, correo, created_at",
      [nombre_usuario, await hashear(contrasena_hash), correoUsuario]
    );
    const usuarioId = usuarioResult.rows[0].id;

    // 2. Crear empresa
    const empresaResult = await pool.query(
      "INSERT INTO empresas (nombre, direccion, telefono, correo) VALUES ($1, $2, $3, $4) RETURNING *",
      [nombre, direccion, telefono, correo]
    );
    const empresaId = empresaResult.rows[0].id;

    // 3. Crear relación empresa-usuario con rol administrador (ID 1)
    await pool.query(
      "INSERT INTO empresa_usuarios (empresa_id, usuario_id, rol_id) VALUES ($1, $2, $3) RETURNING *",
      [empresaId, usuarioId, 1]
    );

    res.status(201).json({
      usuario: usuarioResult.rows[0],
      empresa: empresaResult.rows[0],
    });
  } catch (err) {
    console.error(err);
    res
      .status(500)
      .json({
        error: "Error al registrar la empresa",
        glosa: err.message || err.toString(),
      });
  }
});

module.exports = router;
