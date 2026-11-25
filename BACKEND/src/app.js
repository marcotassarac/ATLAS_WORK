const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const swaggerUi = require("swagger-ui-express");

const { pool } = require("./db");

const authRoutes = require("./routes/auth");
const userRoutes = require("./routes/users");
const clientRoutes = require("./routes/clients");
const contractRoutes = require("./routes/contracts");
const auditRoutes = require("./routes/audit");
const empresasRoutes = require("./routes/empresas");
const rolesRoutes = require("./routes/roles");
const empresaUsuariosRoutes = require("./routes/empresa_usuarios");
const metricasRoutes = require("./routes/metricas");
const registroRoutes = require("./routes/registro");
const { autenticar } = require("./middleware/autenticacion");
const { limiteRegistro } = require("./middleware/limites");
const { manejadorErrores, rutaNoEncontrada } = require("./errores");

const app = express();

app.use(cors());
app.use(express.json());
app.use(morgan("dev"));

// Rutas públicas: inicio de sesión, registro y estado del servicio.
app.use("/autenticacion", authRoutes);
app.use("/registro", limiteRegistro, registroRoutes);
app.get("/", (req, res) => {
  res.json({ name: "Atlas", status: "ok" });
});

const openapi = require("./openapi.json");
app.use("/docs", swaggerUi.serve, swaggerUi.setup(openapi));
app.get("/openapi.json", (req, res) => {
  res.json(openapi);
});

// DEF-04: desde aquí, toda ruta exige un token válido.
app.use(autenticar);

app.use("/usuarios", userRoutes);
app.use("/clientes", clientRoutes);
app.use("/contratos", contractRoutes);
app.use("/auditoria", auditRoutes);
app.use("/empresas", empresasRoutes);
app.use("/roles", rolesRoutes);
app.use("/empresa-usuarios", empresaUsuariosRoutes);
app.use("/metricas", metricasRoutes);

// DEF-10: rutas inexistentes y errores no controlados responden sin detalles internos
app.use(rutaNoEncontrada);
app.use(manejadorErrores);

// DEF-04: se elimina /files/contracts, que servía la carpeta de documentos sin
// autenticación. Los documentos se entregan por /contratos/:id/file.

const { PORT } = require("./config");
const { migrar } = require("./migraciones");

migrar(pool)
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Atlas API escuchando en puerto ${PORT}`);
    });
  })
  .catch((err) => {
    console.error("No se pudo iniciar la API:", err.message);
    process.exit(1);
  });
