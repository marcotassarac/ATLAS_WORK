const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
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
const compartidoRoutes = require("./routes/compartido");
const { autenticar } = require("./middleware/autenticacion");
const { limiteRegistro } = require("./middleware/limites");
const { manejadorErrores, rutaNoEncontrada } = require("./errores");

const { NODE_ENV, CORS_ORIGINS } = require("./config");

const app = express();

// DEF-16: cabeceras de seguridad (CSP, HSTS, nosniff, frame-ancestors, etc.) y sin X-Powered-By
app.use(
  helmet({
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"], baseUri: ["'none'"] } },
    strictTransportSecurity: { maxAge: 31536000, includeSubDomains: true },
    referrerPolicy: { policy: "no-referrer" },
    crossOriginResourcePolicy: { policy: "same-site" },
  })
);
// DEF-16: CORS solo para los orígenes configurados (antes "*": cualquier sitio)
app.use(
  cors({
    origin: (origen, cb) => cb(null, !origen || CORS_ORIGINS.includes(origen)),
    exposedHeaders: ["X-Total-Count", "RateLimit", "RateLimit-Policy", "Retry-After"],
    maxAge: 600,
  })
);
app.use(express.json({ limit: "100kb" }));
app.use(morgan(NODE_ENV === "production" ? "combined" : "dev"));

// Rutas públicas: inicio de sesión, registro y estado del servicio.
app.use("/autenticacion", authRoutes);
app.use("/registro", limiteRegistro, registroRoutes);
// DEF-15 (RF-5.5): descarga con enlace firmado y de vigencia limitada (sin sesión)
app.use("/contratos/compartido", compartidoRoutes);
app.get("/", (req, res) => {
  res.json({ name: "Atlas", status: "ok" });
});

// DEF-16: la documentación interactiva solo se publica fuera de producción
if (NODE_ENV !== "production") {
  const openapi = require("./openapi.json");
  const cspDocs = (req, res, next) => {
    res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:");
    next();
  };
  app.use("/docs", cspDocs, swaggerUi.serve, swaggerUi.setup(openapi));
  app.get("/openapi.json", (req, res) => {
    res.json(openapi);
  });
}

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
