#!/usr/bin/env bash
# Genera un archivo .env con secretos aleatorios para un ambiente local o de QA.
# Uso: scripts/generar_env.sh   (no sobrescribe un .env existente)
set -euo pipefail
cd "$(dirname "$0")/.."
if [ -f .env ]; then echo ".env ya existe; no se modifica."; exit 0; fi
aleatorio() { openssl rand -base64 "$1" | tr -d '/+=\n' | cut -c1-"$2"; }
sed -e "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(aleatorio 48 32)|" \
    -e "s|^JWT_SECRET=.*|JWT_SECRET=$(aleatorio 64 64)|" .env.example > .env
chmod 600 .env
echo ".env generado con secretos aleatorios."
