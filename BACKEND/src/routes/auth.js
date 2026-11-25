const express = require("express");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { pool } = require("../db");
const { verificar } = require("../seguridad/contrasenas");
const { autenticar } = require("../middleware/autenticacion");
const { limiteLoginPorIp, limiteLoginPorUsuario } = require("../middleware/limites");

const router = express.Router();

const { JWT_SECRET } = require("../config");


// Inicio de sesión. DEF-03: la contraseña se compara contra su hash bcrypt.
router.post("/login", limiteLoginPorIp, limiteLoginPorUsuario, async (req, res, next) => {
  const { nombre_usuario, password } = req.body;
  try {
    const result = await pool.query(
      "SELECT id, nombre_usuario, contrasena_hash FROM usuarios WHERE nombre_usuario = $1",
      [nombre_usuario]
    );
    const user = result.rows[0];
    // verificar() consume el mismo tiempo si el usuario no existe (sin enumeración)
    const valida = await verificar(password, user ? user.contrasena_hash : undefined);
    if (!user || !valida) {
      return res.status(401).json({ error: "Credenciales inválidas" });
    }

    // Obtener el empresa_usuario id, empresa_id y rol más reciente para este usuario
    const empresaUsuarioResult = await pool.query(
      `SELECT eu.id, eu.empresa_id, r.nombre AS rol
         FROM empresa_usuarios eu LEFT JOIN roles r ON r.id = eu.rol_id
        WHERE eu.usuario_id = $1 ORDER BY eu.id DESC LIMIT 1`,
      [user.id]
    );
    const empresaUsuarioId = empresaUsuarioResult.rows.length > 0 
      ? empresaUsuarioResult.rows[0].id 
      : null;
    const empresaId = empresaUsuarioResult.rows.length > 0 
      ? empresaUsuarioResult.rows[0].empresa_id 
      : null;

    const token = jwt.sign(
      { 
        usuarioId: user.id, 
        nombreUsuario: user.nombre_usuario,
        empresaUsuarioId: empresaUsuarioId,
        empresaId: empresaId,
        // DEF-05: el rol viaja en el token solo para que la interfaz muestre las
        // opciones correctas; el servidor siempre lo vuelve a consultar en la base.
        rol: empresaUsuarioResult.rows[0]?.rol || "editor",
      },
      JWT_SECRET,
      // DEF-07: jwtid identifica el token para poder revocarlo al cerrar sesión
      { expiresIn: "2h", algorithm: "HS256", jwtid: crypto.randomUUID() }
    );

    // Registrar en auditoría
    await pool.query(
      "INSERT INTO auditoria (usuario_id, accion) VALUES ($1, $2)",
      [user.nombre_usuario, "LOGIN: usuario inició sesión"]
    );

    res.json({ token });
  } catch (err) {
    next(err);
  }
});

// Cierre de sesión (RF-1.2). DEF-07: antes no existía; el token seguía sirviendo
// hasta su vencimiento aunque el usuario cerrara sesión.
router.post("/logout", autenticar, async (req, res, next) => {
  try {
    const { jti, exp, usuarioId, nombreUsuario } = req.usuario;
    await pool.query(
      "INSERT INTO tokens_revocados (jti, usuario_id, expira_en) VALUES ($1, $2, to_timestamp($3)) ON CONFLICT (jti) DO NOTHING",
      [jti, usuarioId, exp]
    );
    // Limpieza de revocaciones que ya vencieron (no necesitan seguir guardadas)
    await pool.query("DELETE FROM tokens_revocados WHERE expira_en < now()");
    await pool.query("INSERT INTO auditoria (usuario_id, accion) VALUES ($1, $2)", [
      nombreUsuario,
      "LOGOUT: usuario cerró sesión",
    ]);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
