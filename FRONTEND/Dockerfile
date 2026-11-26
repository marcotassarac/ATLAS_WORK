# Etapa 1: Construcción
# DEF-19: Node 22 y "npm ci": se instalan exactamente las versiones de package-lock.json.
# La v1.0 borraba package-lock.json antes de instalar, por lo que cada construcción podía
# traer versiones distintas (y vulnerables) de las dependencias.
FROM node:22-alpine AS builder

WORKDIR /app

ARG VITE_API_URL=/api

COPY package*.json ./
RUN npm ci

COPY . .
ENV VITE_API_URL=${VITE_API_URL}
RUN npm run build

# Etapa 2: Producción
# DEF-19: nginx sin privilegios (usuario nginx, uid 101); escucha en 8080 y 8443.
FROM nginxinc/nginx-unprivileged:alpine

# v2.1: parches de seguridad del sistema base (Trivy: brotli, curl, libxml2, musl, zlib)
USER root
RUN apk upgrade --no-cache

COPY --from=builder /app/dist /usr/share/nginx/html
# DEF-17: plantilla con TLS; la imagen sustituye ${NGINX_PUERTO_HTTPS} al iniciar
COPY nginx.conf /etc/nginx/templates/default.conf.template
COPY cabeceras_seguridad.conf /etc/nginx/snippets/cabeceras_seguridad.conf

# v2.1: usuario sin privilegios declarado explícitamente (Trivy DS-0002, Semgrep missing-user)
USER 101

EXPOSE 8080 8443

CMD ["nginx", "-g", "daemon off;"]
