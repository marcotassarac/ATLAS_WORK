# Seguridad de Atlas (versión 2.0)

## Controles implementados

| Área (OWASP Top 10:2021) | Control | Versión |
|---|---|---|
| A01 Control de acceso | Autenticación obligatoria en toda la API (middleware central; solo login, registro y estado son públicos) | v1.4 |
| A01 Control de acceso | Rol consultado en la base en cada solicitud; escrituras solo para administradores; catálogo de roles de solo lectura | v1.5 |
| A01 Control de acceso | Aislamiento multiempresa: cada consulta filtra por la empresa de la sesión (404 para datos ajenos) | v1.6 |
| A02 Criptografía | Contraseñas con bcrypt (costo 12) y política del ERS 2.4 | v1.3 |
| A02 Criptografía | HTTPS con TLS 1.2/1.3, redirección 301 y HSTS de un año | v1.17 |
| A02 Criptografía | Datos bancarios cifrados en reposo con AES-256-GCM | v1.18 |
| A03 Inyección | Consultas parametrizadas; validación de todos los campos en el servidor (RUT, correo, teléfono, fechas); sin < ni > en textos | v1.9 |
| A04 Diseño inseguro | Documentos: 10 MB máximo, solo formatos del RF-5.2 y verificación de la firma binaria | v1.11 |
| A04 Diseño inseguro | Registro atómico con consentimiento informado (Ley 21.719) | v1.13 |
| A05 Configuración | Errores sin detalles internos; cabeceras de seguridad (CSP, HSTS, X-Frame-Options, nosniff); CORS por lista blanca; sin versiones expuestas | v1.10, v1.16 |
| A05 Configuración | Contenedores sin root, sistema de archivos de solo lectura, sin capacidades; base solo en 127.0.0.1; cuenta de base sin privilegios de administración | v1.19 |
| A06 Componentes vulnerables | Dependencias actualizadas; npm audit y Trivy en el pipeline y cada semana | v1.20, v2.0 |
| A07 Autenticación | Sin secretos en el código ni en la documentación; secreto JWT de 32+ caracteres obligatorio | v1.1, v1.25 |
| A07 Autenticación | Cierre de sesión con revocación del token (jti) | v1.7 |
| A07 Autenticación | 5 intentos fallidos por usuario e IP cada 15 minutos (429) | v1.8 |
| A09 Registro y monitoreo | Auditoría generada solo por el servidor, en la misma transacción que la operación, por empresa e inmodificable por la API | v1.12, v1.19 |
| A09 Registro y monitoreo | Los logs no contienen contraseñas, tokens ni enlaces de descarga | v1.23 |

## Configuración segura

- Los secretos se entregan por variables de entorno (`.env`, ver `.env.example`) y nunca se versionan.
  `scripts/generar_env.sh` crea valores aleatorios. Sin ellos, los servicios no inician.
- La clave `DATA_ENCRYPTION_KEY` debe guardarse en un gestor de secretos y respaldarse aparte: sin ella
  los datos bancarios cifrados no se pueden recuperar.
- Los valores de `JWT_SECRET` y de la contraseña de PostgreSQL publicados en la versión 1.0 (código,
  docker-compose.yml y README) están comprometidos y no deben reutilizarse.
- En producción se debe usar un certificado TLS emitido por una autoridad reconocida.

## Riesgos residuales conocidos

| Riesgo | Tratamiento propuesto |
|---|---|
| Los documentos se guardan en la base (bytea) y no en almacenamiento interno con referencia (RF-5.3) | Migrar a un almacenamiento de objetos con cifrado del lado del servidor |
| El límite de intentos se guarda en memoria (una instancia) | Usar un almacén compartido (Redis) si se escala horizontalmente |
| LCP de 2,7 s en móvil con 4G simulado (umbral del ERS: 2 s) | Prerenderizar el login o aplicar renderizado en el servidor |
| Cuentas de ejemplo del dump (`admin`, `editor`) | Eliminarlas o cambiar sus contraseñas antes de cualquier uso real |
| Sin pruebas con usuarios reales adultos mayores (CP-19) | Aplicar el cuestionario de usabilidad con consentimiento informado |

## Reporte de vulnerabilidades

Escribir a seguridad@atlasfake.com con la descripción y los pasos para reproducir. No publicar el
hallazgo hasta acordar una fecha de corrección. Se responde en un máximo de 5 días hábiles.
