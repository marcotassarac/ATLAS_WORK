# DEF-19 / v2.1: imagen mínima y sin privilegios.
# Etapa 1: instala solo las dependencias de producción, exactamente desde package-lock.json.
FROM node:22-alpine AS dependencias
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Etapa 2: imagen de ejecución
# - Node.js 22 LTS (la v1.0 usaba Node 18, sin soporte de seguridad desde abril de 2025).
# - v2.1: se quitan npm, npx y corepack, que la API no usa en ejecución y cuyas dependencias
#   internas (pacote, sigstore, brace-expansion, picomatch) tenían vulnerabilidades altas (Trivy).
# - Paquetes del sistema actualizados y proceso con el usuario "node" (uid 1000), no root.
FROM node:22-alpine
ENV NODE_ENV=production
RUN apk upgrade --no-cache \
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
           /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack
WORKDIR /app
COPY --from=dependencias /app/node_modules ./node_modules
COPY package.json ./
COPY src/ ./src/
COPY sql/migraciones/ ./sql/migraciones/

USER node
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://127.0.0.1:4000/ >/dev/null || exit 1

CMD ["node", "src/app.js"]
