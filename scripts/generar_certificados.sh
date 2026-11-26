#!/usr/bin/env bash
# DEF-17: genera un certificado TLS autofirmado para el ambiente local o de QA.
# En producción se debe usar un certificado emitido por una autoridad (por ejemplo,
# Let's Encrypt) o el de un balanceador administrado.
# Uso: scripts/generar_certificados.sh   (no sobrescribe certificados existentes)
set -euo pipefail
export MSYS_NO_PATHCONV=1
cd "$(dirname "$0")/.."
mkdir -p certs
if [ -f certs/atlas.crt ]; then echo "certs/atlas.crt ya existe; no se modifica."; exit 0; fi
openssl req -x509 -newkey rsa:3072 -sha256 -nodes -days 397 \
  -keyout certs/atlas.key -out certs/atlas.crt \
  -subj "/C=CL/O=Atlas QA/CN=localhost" \
  -addext "subjectAltName=DNS:localhost,DNS:host.docker.internal,IP:127.0.0.1" >/dev/null 2>&1
chmod 600 certs/atlas.key
echo "Certificado generado en certs/ (válido por 397 días)."
