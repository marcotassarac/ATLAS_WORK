// DEF-05: autorización por rol en el servidor (RF-3.2, RB-4, RB-5, NFR-SEG-4).
// El editor solo lee; toda escritura exige el rol administrador.
function requiereRol(...roles) {
  return (req, res, next) => {
    if (req.usuario && roles.includes(req.usuario.rol)) return next();
    return res.status(403).json({ error: "Prohibido", glosa: "Su rol no permite realizar esta operación." });
  };
}

const soloAdministrador = requiereRol("administrador");

module.exports = { requiereRol, soloAdministrador };
