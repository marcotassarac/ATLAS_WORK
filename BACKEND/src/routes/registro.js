// Registro público de un usuario y su empresa (RF-2.1 a RF-2.3).
// DEF-04: se separa de /empresas para que sea la única escritura pública de la API;
// todo lo demás exige autenticación.
const express = require("express");
const { pool } = require("../db");
const { validarCliente, validarContrato, validarEmpresa, validarUsuarioNuevo, Validador, hayErrores, responderErrores } = require("../validacion");
const { erroresPolitica, mensajePolitica, hashear } = require("../seguridad/contrasenas");

const router = express.Router();

const prefijar = (p, e) => Object.fromEntries(Object.entries(e).map(([k, v]) => [p + k, v]));

router.post("/", async (req, res, next) => {
  if (!req.body || !req.body.usuario || !req.body.empresa) {
    return res.status(400).json({ error: "Datos inválidos", glosa: "Debe enviar los datos del usuario y de la empresa." });
  }
  // DEF-09: validación de los datos del usuario y de la empresa
  const vu = validarUsuarioNuevo(req.body.usuario);
  const ve = validarEmpresa(req.body.empresa);
  const errores = { ...prefijar("usuario.", vu.errores), ...prefijar("empresa.", ve.errores) };
  if (hayErrores(errores)) return responderErrores(res, errores);
  const { nombre_usuario, correo: correoUsuario } = vu.datos;
  const { contrasena_hash } = req.body.usuario;
  const { nombre, direccion, telefono, correo } = ve.datos;

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
    next(err);
  }
});

module.exports = router;
