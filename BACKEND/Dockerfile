# DEF-19: imagen mínima y sin privilegios.
# - Node.js 22 LTS (la v1.0 usaba Node 18, sin soporte de seguridad desde abril de 2025).
# - Solo dependencias de producción, instaladas exactamente desde package-lock.json.
# - El proceso corre con el usuario "node" (uid 1000), no como root.
FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Solo el código y las migraciones (el dump de ejemplo se monta en PostgreSQL)
COPY src/ ./src/
COPY sql/migraciones/ ./sql/migraciones/

USER node
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://127.0.0.1:4000/ >/dev/null || exit 1

CMD ["node", "src/app.js"]
