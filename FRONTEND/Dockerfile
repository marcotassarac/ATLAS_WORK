# Etapa 1: Construcción
FROM node:20 AS builder

WORKDIR /app

# Argumento para la URL de la API
ARG VITE_API_URL=/api

# Copiar archivos de dependencias
COPY package*.json ./

# Limpiar completamente e instalar dependencias
# Esto soluciona problemas con dependencias opcionales de rollup y esbuild
RUN rm -rf node_modules package-lock.json && \
    npm install && \
    npm install @rollup/rollup-linux-x64-gnu --save-optional && \
    npm rebuild esbuild

# Copiar código fuente
COPY . .

# Establecer variable de entorno para el build
ENV VITE_API_URL=${VITE_API_URL}

# Reinstalar esbuild después de copiar todo para asegurar compatibilidad
RUN rm -rf node_modules/.cache && \
    npm rebuild esbuild --force || \
    (npm uninstall esbuild && npm install esbuild)

# Construir la aplicación
RUN npm run build

# Etapa 2: Producción
FROM nginx:alpine

# Copiar los archivos construidos desde la etapa de construcción
COPY --from=builder /app/dist /usr/share/nginx/html

# Copiar configuración de nginx personalizada
# DEF-17: plantilla con TLS; la imagen sustituye ${NGINX_PUERTO_HTTPS} al iniciar
COPY nginx.conf /etc/nginx/templates/default.conf.template
COPY cabeceras_seguridad.conf /etc/nginx/snippets/cabeceras_seguridad.conf

EXPOSE 8080 8443

# Comando para iniciar nginx
CMD ["nginx", "-g", "daemon off;"]

