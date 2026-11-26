# Registro de cambios

Cada versión corrige un defecto (DEF) detectado en el Ciclo 1 de pruebas de la Evaluación Parcial 3.
El detalle de cada cambio (problema, cambio y justificación) está en el mensaje del commit de su etiqueta
(`git show v1.N`).

| Versión | Defecto | Severidad | Cambio |
|---|---|---|---|
| v1.0 | — | — | Línea base: Código Fuente A sin modificaciones (Ciclo 1) |
| v1.1 | DEF-01 | Crítica | Secretos fuera del código y del repositorio |
| v1.2 | DEF-02 | Alta | Eliminación del retardo artificial de 4 segundos |
| v1.3 | DEF-03 | Crítica | Contraseñas con bcrypt y política de contraseñas; ejecutor de migraciones |
| v1.4 | DEF-04 | Crítica | Autenticación obligatoria en toda la API |
| v1.5 | DEF-05 | Crítica | Autorización por rol en el servidor y en la interfaz |
| v1.6 | DEF-06 | Crítica | Aislamiento entre empresas (IDOR) |
| v1.7 | DEF-07 | Alta | Cierre de sesión con revocación del token |
| v1.8 | DEF-08 | Alta | Límite de intentos de inicio de sesión y de registro |
| v1.9 | DEF-09 | Alta | Validación de entradas en el servidor |
| v1.10 | DEF-10 | Media | Manejo de errores sin detalles internos |
| v1.11 | DEF-11 | Alta | Documentos: límite de tamaño, tipos permitidos y firma binaria |
| v1.12 | DEF-12 | Alta | Auditoría íntegra, atómica y por empresa |
| v1.13 | DEF-13 | Alta | Registro atómico con consentimiento informado |
| v1.14 | DEF-14 | Media | Eliminación lógica de clientes y paginación |
| v1.15 | DEF-15 | Media | Gestión de usuarios, estado de contratos y enlace para compartir |
| v1.16 | DEF-16 | Media | Cabeceras de seguridad, CORS restringido, sin versiones expuestas |
| v1.17 | DEF-17 | Alta | HTTPS obligatorio con TLS 1.2+ y HSTS |
| v1.18 | DEF-18 | Alta | Cifrado en reposo de datos bancarios (AES-256-GCM) |
| v1.19 | DEF-19 | Media | Contenedores sin root y cuenta de base con mínimo privilegio |
| v1.20 | DEF-20 | Alta | Actualización de dependencias vulnerables |
| v1.21 | DEF-21 | Media | Accesibilidad WCAG 2.1 AA y diseño responsivo |
| v1.22 | DEF-22 | Media | Carga inicial más liviana (NFR-PERF-2) |
| v1.23 | DEF-23 | Media | El token de los enlaces compartidos no se registra en los logs (regresión de v1.15) |
| v1.24 | DEF-21 | Media | Complemento: menú lateral con semántica de navegación |
| v1.25 | DEF-01 | Crítica | Complemento: la documentación ya no publica secretos |
| v2.0 | — | — | Pipeline de controles automatizados, pruebas unitarias, reglas Semgrep propias y documentación de seguridad (Ciclo 2) |
