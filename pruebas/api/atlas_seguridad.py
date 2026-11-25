#!/usr/bin/env python3
"""
Suite automatizada de pruebas funcionales y de seguridad - Sistema Atlas
ISY1102 Seguridad y Calidad en el Desarrollo de Software - Evaluacion Parcial 3

Cada caso esta trazado a un requisito del ERS (RF, NFR, RB) o a una
categoria de OWASP Top 10:2021 / ASVS 4.0.3. La suite no depende de la
version del sistema: verifica el comportamiento que exige el ERS, por lo
que la misma ejecucion sirve para la linea base (Ciclo 1) y para la
version corregida (Ciclo 2, regresion).

Uso:
  python pruebas/api/atlas_seguridad.py            (variables de entorno abajo)

Variables de entorno:
  API_URL        URL base de la API        (por defecto http://localhost:4450)
  FRONT_URL      URL del frontend          (por defecto http://localhost:3350)
  HTTP_FRONT_URL URL HTTP del frontend para verificar la redireccion a HTTPS
  CICLO          1 o 2                     (solo se registra en el resultado)
  VERSION_SUT    version probada           (por ejemplo v1.0 o v2.0)
  OUT_DIR        carpeta de resultados     (por defecto resultados/)
  DB_CONTAINER   contenedor PostgreSQL     (por defecto atlas-postgres)
  API_CONTAINER  contenedor del backend    (por defecto atlas-backend)
  FRONT_CONTAINER contenedor del frontend  (por defecto atlas-frontend)
  INSECURE_TLS   1 para aceptar el certificado autofirmado del laboratorio
  SOLO           lista de IDs separados por coma para ejecutar solo esos casos

Salida: resultados.json (evidencia completa por caso) y resumen.md.
"""
import base64
import concurrent.futures
import datetime
import hashlib
import hmac
import json
import os
import re
import ssl
import statistics
import subprocess
import sys
import time
import traceback
import urllib.error
import urllib.request
import uuid

API = os.environ.get("API_URL", "http://localhost:4450").rstrip("/")
FRONT = os.environ.get("FRONT_URL", "http://localhost:3350").rstrip("/")
HTTP_FRONT = os.environ.get("HTTP_FRONT_URL", "http://localhost:3350").rstrip("/")
CICLO = os.environ.get("CICLO", "1")
VERSION_SUT = os.environ.get("VERSION_SUT", "v1.0")
OUT_DIR = os.environ.get("OUT_DIR", "resultados")
DB_CONTAINER = os.environ.get("DB_CONTAINER", "atlas-postgres")
API_CONTAINER = os.environ.get("API_CONTAINER", "atlas-backend")
FRONT_CONTAINER = os.environ.get("FRONT_CONTAINER", "atlas-frontend")
INSECURE_TLS = os.environ.get("INSECURE_TLS") == "1"
SOLO = [x.strip() for x in os.environ.get("SOLO", "").split(",") if x.strip()]

ADMIN = ("admin", "admin")
EDITOR = ("editor", "editor")
# Contrasena que cumple la politica del ERS 2.4 (12+ caracteres, mayuscula,
# minuscula, numero y simbolo). Es un dato de prueba sintetico.
CLAVE_FUERTE = "Atlas#Prueba2026"
SFX = datetime.datetime.now().strftime("%m%d%H%M%S")

SSL_CTX = ssl.create_default_context()
if INSECURE_TLS:
    SSL_CTX.check_hostname = False
    SSL_CTX.verify_mode = ssl.CERT_NONE

PATRONES_INTERNOS = re.compile(
    r"duplicate key|violates|constraint|syntax error|invalid input syntax|"
    r"relation \"|column \"|pg_|ECONNREFUSED|at .*\.js:\d+|stack|SequelizeError|"
    r"null value in column",
    re.I,
)

# --------------------------------------------------------------------------
# Utilidades HTTP
# --------------------------------------------------------------------------


class SinRedireccion(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


OPENER = urllib.request.build_opener(
    SinRedireccion(), urllib.request.HTTPSHandler(context=SSL_CTX)
)


class Resp:
    def __init__(self, status, headers, body, ms, metodo, url, req_headers, req_body):
        self.status = status
        self.headers = {k.lower(): v for k, v in headers.items()}
        self.body = body
        self.ms = ms
        self.metodo = metodo
        self.url = url
        self.req_headers = req_headers
        self.req_body = req_body
        try:
            self.json = json.loads(body) if body else None
        except ValueError:
            self.json = None

    def texto(self, n=700):
        b = self.body or ""
        if isinstance(b, bytes):
            return f"<{len(b)} bytes binarios>"
        return b if len(b) <= n else b[:n] + f"... (+{len(b) - n} caracteres)"


def ocultar(valor):
    """Oculta tokens en la evidencia: muestra solo el inicio."""
    if not valor:
        return valor
    return re.sub(r"(eyJ[A-Za-z0-9_-]{6})[A-Za-z0-9._-]+", r"\1…", str(valor))


def http(metodo, ruta, body=None, token=None, headers=None, raw=None,
         content_type=None, base=None, timeout=90):
    url = ruta if ruta.startswith("http") else (base or API) + ruta
    h = {"Accept": "application/json"}
    data = None
    if raw is not None:
        data = raw
        if content_type:
            h["Content-Type"] = content_type
    elif body is not None:
        data = json.dumps(body).encode("utf-8")
        h["Content-Type"] = "application/json"
    if token:
        h["Authorization"] = f"Bearer {token}"
    if headers:
        h.update(headers)
    req = urllib.request.Request(url, data=data, method=metodo, headers=h)
    t0 = time.perf_counter()
    try:
        with OPENER.open(req, timeout=timeout) as r:
            cuerpo = r.read()
            status, rh = r.status, dict(r.headers)
    except urllib.error.HTTPError as e:
        cuerpo = e.read()
        status, rh = e.code, dict(e.headers or {})
    ms = (time.perf_counter() - t0) * 1000
    ctype = (rh.get("Content-Type") or rh.get("content-type") or "")
    if "json" in ctype or "text" in ctype or not ctype:
        try:
            cuerpo = cuerpo.decode("utf-8")
        except UnicodeDecodeError:
            pass
    req_body = None
    if body is not None:
        req_body = json.dumps(body, ensure_ascii=False)
    elif raw is not None:
        req_body = f"<multipart/binario {len(raw)} bytes>"
    req_h = {k: (ocultar(v) if k == "Authorization" else v) for k, v in h.items()}
    return Resp(status, rh, cuerpo, ms, metodo, url, req_h, req_body)


def multipart(campos, archivos):
    limite = "----AtlasQA" + uuid.uuid4().hex
    partes = []
    for k, v in campos.items():
        partes.append(
            f"--{limite}\r\nContent-Disposition: form-data; name=\"{k}\"\r\n\r\n{v}\r\n".encode()
        )
    for k, (nombre, contenido, ctype) in archivos.items():
        partes.append(
            (f"--{limite}\r\nContent-Disposition: form-data; name=\"{k}\"; "
             f"filename=\"{nombre}\"\r\nContent-Type: {ctype}\r\n\r\n").encode()
            + contenido + b"\r\n"
        )
    partes.append(f"--{limite}--\r\n".encode())
    return b"".join(partes), f"multipart/form-data; boundary={limite}"


def b64url(data):
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def b64url_dec(s):
    s += "=" * (-len(s) % 4)
    return base64.urlsafe_b64decode(s)


def jwt_payload(token):
    try:
        return json.loads(b64url_dec(token.split(".")[1]))
    except Exception:
        return None


def jwt_firmar(payload, secreto, alg="HS256"):
    cab = b64url(json.dumps({"alg": alg, "typ": "JWT"}).encode())
    cue = b64url(json.dumps(payload).encode())
    if alg == "none":
        return f"{cab}.{cue}."
    firma = hmac.new(secreto.encode(), f"{cab}.{cue}".encode(), hashlib.sha256).digest()
    return f"{cab}.{cue}.{b64url(firma)}"


def psql(sql):
    """Consulta de verificacion directa a la base (solo lectura del arnes)."""
    out = subprocess.run(
        ["docker", "exec", DB_CONTAINER, "psql", "-U", "postgres", "-d", "atlas",
         "-t", "-A", "-F", "|", "-c", sql],
        capture_output=True, text=True, encoding="utf-8", timeout=60,
    )
    if out.returncode != 0:
        raise RuntimeError(out.stderr.strip())
    return out.stdout.strip()


def docker(*args, timeout=120):
    out = subprocess.run(["docker", *args], capture_output=True, text=True,
                         encoding="utf-8", errors="replace", timeout=timeout)
    return out.returncode, (out.stdout or "") + (out.stderr or "")


def login(usuario, clave):
    r = http("POST", "/autenticacion/login", {"nombre_usuario": usuario, "password": clave})
    token = r.json.get("token") if isinstance(r.json, dict) else None
    return r, token


def registrar(datos):
    """Registro público. Desde la v1.4 la ruta es POST /registro; en la v1.0 era POST /empresas."""
    r = http("POST", "/registro", datos)
    if r.status == 404:
        r = http("POST", "/empresas", datos)
    return r


PDF = (b"%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
       b"2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n")
EXE = b"MZ\x90\x00\x03\x00\x00\x00\x04\x00\x00\x00\xff\xff" + b"\x00" * 200

# --------------------------------------------------------------------------
# Registro de casos y evidencia
# --------------------------------------------------------------------------

CASOS = []


class Caso:
    def __init__(self, id, nombre, requisitos, tipo, herramienta, esperado, owasp=""):
        self.id = id
        self.nombre = nombre
        self.requisitos = requisitos
        self.tipo = tipo
        self.herramienta = herramienta
        self.esperado = esperado
        self.owasp = owasp
        self.pasos = []
        self.estado = None
        self.nota = ""
        self.inicio = None
        self.fin = None

    def paso(self, descripcion, ok, resp=None, obtenido="", consulta=None):
        p = {"descripcion": descripcion, "ok": bool(ok), "obtenido": obtenido}
        if resp is not None:
            p["peticion"] = {
                "metodo": resp.metodo,
                "url": resp.url,
                "cabeceras": resp.req_headers,
                "cuerpo": ocultar(resp.req_body),
            }
            p["respuesta"] = {
                "status": resp.status,
                "ms": round(resp.ms, 1),
                "cabeceras": {k: v for k, v in resp.headers.items()
                              if k in ("content-type", "x-powered-by", "access-control-allow-origin",
                                       "strict-transport-security", "content-security-policy",
                                       "x-content-type-options", "x-frame-options", "location",
                                       "x-total-count", "retry-after", "server", "referrer-policy",
                                       "ratelimit-remaining", "ratelimit-limit")},
                "cuerpo": ocultar(resp.texto()),
            }
            if not obtenido:
                p["obtenido"] = f"HTTP {resp.status}"
        if consulta is not None:
            p["consulta"] = consulta
        self.pasos.append(p)
        return ok

    def a_dict(self):
        return {
            "id": self.id, "nombre": self.nombre, "requisitos": self.requisitos,
            "tipo": self.tipo, "herramienta": self.herramienta, "owasp": self.owasp,
            "esperado": self.esperado, "estado": self.estado, "nota": self.nota,
            "inicio": self.inicio, "fin": self.fin, "pasos": self.pasos,
            "ciclo": CICLO, "version": VERSION_SUT,
        }


def caso(id, nombre, requisitos, tipo, esperado, owasp="", herramienta="atlas_seguridad.py (Python 3, urllib)"):
    def deco(fn):
        CASOS.append((Caso(id, nombre, requisitos, tipo, herramienta, esperado, owasp), fn))
        return fn
    return deco


class Contexto:
    """Datos compartidos entre casos: tokens y registros de prueba."""
    pass


CTX = Contexto()


def preparar():
    CTX.r_admin, CTX.t_admin = login(*ADMIN)
    CTX.r_editor, CTX.t_editor = login(*EDITOR)
    if not CTX.t_admin:
        raise RuntimeError(f"No fue posible iniciar sesion como admin: {CTX.r_admin.status} {CTX.r_admin.texto()}")
    # Empresa B (segundo inquilino) creada por el registro publico
    CTX.usuario_b = f"adminb_{SFX}"
    reg = registrar({
        "usuario": {"nombre_usuario": CTX.usuario_b, "contrasena_hash": CLAVE_FUERTE,
                    "correo": f"adminb_{SFX}@prueba.cl"},
        "empresa": {"nombre": f"Empresa B {SFX}", "direccion": "Calle Falsa 123",
                    "telefono": "+56911112222", "correo": f"empresab_{SFX}@prueba.cl"},
        "acepta_politica": True,
    })
    CTX.reg_b = reg
    _, CTX.t_b = login(CTX.usuario_b, CLAVE_FUERTE)
    # Cliente y contrato de la empresa A usados por las pruebas de aislamiento
    c = http("POST", "/clientes", {"nombre": f"Cliente QA {SFX}", "correo": f"qa_{SFX}@cliente.cl",
                                    "telefono": "+56922223333", "direccion": "Av. Prueba 100"},
             token=CTX.t_admin)
    CTX.cliente_a = c.json.get("id") if isinstance(c.json, dict) else None
    body, ct = multipart({"cliente_id": CTX.cliente_a, "titulo": f"Contrato QA {SFX}",
                          "descripcion": "Contrato de prueba", "fecha_inicio": "2026-01-01",
                          "fecha_fin": "2027-12-31"},
                         {"file": ("contrato_qa.pdf", PDF, "application/pdf")})
    k = http("POST", "/contratos", raw=body, content_type=ct, token=CTX.t_admin)
    CTX.contrato_a = k.json.get("id") if isinstance(k.json, dict) else None


# --------------------------------------------------------------------------
# CASOS DE PRUEBA FUNCIONALES (trazados al ERS)
# --------------------------------------------------------------------------


@caso("CP-01", "Inicio de sesión exitoso con credenciales válidas", "RF-1.1, NFR-SEG-9",
      "Funcional", "HTTP 200 con token JWT; claims usuarioId y empresaId; vigencia de 2 h (7.200 s); "
      "el token permite consultar /clientes y se registra el evento LOGIN en auditoría.")
def cp01(c):
    r = CTX.r_admin
    c.paso("POST /autenticacion/login con admin responde 200 y entrega token", r.status == 200 and bool(CTX.t_admin), r)
    p = jwt_payload(CTX.t_admin) or {}
    claims_ok = all(k in p for k in ("usuarioId", "empresaId"))
    c.paso("El token contiene los claims usuarioId y empresaId", claims_ok,
           obtenido=f"claims: {sorted(p.keys())}")
    vig = (p.get("exp", 0) - p.get("iat", 0))
    c.paso("La vigencia del token es de 7.200 s (2 h)", vig == 7200, obtenido=f"exp - iat = {vig} s")
    r2 = http("GET", "/clientes", token=CTX.t_admin)
    c.paso("GET /clientes con el token responde 200", r2.status == 200, r2)
    n = psql("SELECT count(*) FROM auditoria WHERE accion LIKE 'LOGIN%' AND fecha_hora > now() - interval '15 minutes'")
    c.paso("Existe un registro LOGIN reciente en la tabla auditoria", int(n or 0) > 0,
           obtenido=f"{n} registros LOGIN en los últimos 15 minutos",
           consulta="SELECT count(*) FROM auditoria WHERE accion LIKE 'LOGIN%' AND fecha_hora > now() - interval '15 minutes'")


@caso("CP-02", "Rechazo de credenciales inválidas sin enumeración de usuarios", "RF-1.1, ERS 2.4",
      "Funcional / Seguridad", "HTTP 401 con el mismo mensaje genérico para contraseña incorrecta y para usuario inexistente; sin token.",
      owasp="A07:2021")
def cp02(c):
    r1, t1 = login("admin", "incorrecta123")
    c.paso("Contraseña incorrecta responde 401 sin token", r1.status == 401 and not t1, r1)
    r2, t2 = login(f"no_existe_{SFX}", "cualquiera")
    c.paso("Usuario inexistente responde 401 sin token", r2.status == 401 and not t2, r2)
    m1 = (r1.json or {}).get("error") if isinstance(r1.json, dict) else r1.body
    m2 = (r2.json or {}).get("error") if isinstance(r2.json, dict) else r2.body
    c.paso("Ambos mensajes son idénticos (no revela si el usuario existe)", m1 == m2,
           obtenido=f"«{m1}» / «{m2}»")


@caso("CP-03", "Contraseñas almacenadas con hash bcrypt", "NFR-SEG-2, ERS 2.4",
      "Seguridad", "0 contraseñas sin formato bcrypt ($2a$/$2b$) en la tabla usuarios; ninguna coincide con su valor en texto plano.",
      owasp="A02:2021 · CWE-256")
def cp03(c):
    sql = "SELECT nombre_usuario, left(contrasena_hash, 7), length(contrasena_hash), contrasena_hash ~ '^\\$2[aby]\\$[0-9]{2}\\$' FROM usuarios ORDER BY id"
    filas = [f.split("|") for f in psql(sql).splitlines() if f]
    sin_bcrypt = [f[0] for f in filas if f[3] != "t"]
    detalle = "; ".join(f"{f[0]}: «{f[1]}…» largo {f[2]}" for f in filas[:6])
    c.paso("Todas las contraseñas tienen formato bcrypt", not sin_bcrypt,
           obtenido=f"{len(filas)} usuarios, {len(sin_bcrypt)} sin bcrypt. Muestra (7 primeros caracteres): {detalle}",
           consulta="SELECT nombre_usuario, left(contrasena_hash,7), length(contrasena_hash) FROM usuarios")
    plano = psql("SELECT count(*) FROM usuarios WHERE contrasena_hash IN ('admin','editor')")
    c.paso("Ninguna contraseña conocida está guardada en texto plano", plano == "0",
           obtenido=f"{plano} coincidencias con 'admin' o 'editor' en texto plano",
           consulta="SELECT count(*) FROM usuarios WHERE contrasena_hash IN ('admin','editor')")
    r, t = login(*ADMIN)
    c.paso("El inicio de sesión sigue funcionando (comparación contra el hash)", r.status == 200 and bool(t), r)


@caso("CP-04", "Rol editor de solo lectura", "RF-3.2, RB-4, RB-5, NFR-SEG-4",
      "Seguridad (control de acceso)", "El editor lee (200) y toda escritura responde 403; el administrador sí puede escribir.",
      owasp="A01:2021 · CWE-862")
def cp04(c):
    if not CTX.t_editor:
        raise RuntimeError("No se pudo iniciar sesión como editor")
    r = http("GET", "/clientes", token=CTX.t_editor)
    c.paso("Editor: GET /clientes responde 200", r.status == 200, r)
    r = http("POST", "/clientes", {"nombre": f"Cliente Editor {SFX}", "correo": f"editor_{SFX}@cliente.cl",
                                    "telefono": "+56933334444", "direccion": "Calle 1"}, token=CTX.t_editor)
    creado = r.json.get("id") if isinstance(r.json, dict) else None
    c.paso("Editor: POST /clientes responde 403", r.status == 403, r)
    objetivo = creado or CTX.cliente_a
    r = http("PUT", f"/clientes/{objetivo}", {"nombre": "Modificado por editor", "correo": f"mod_{SFX}@cliente.cl",
                                               "telefono": "+56933334444", "direccion": "Calle 1"}, token=CTX.t_editor)
    c.paso(f"Editor: PUT /clientes/{objetivo} responde 403", r.status == 403, r)
    if creado:
        r = http("DELETE", f"/clientes/{creado}", token=CTX.t_editor)
        c.paso(f"Editor: DELETE /clientes/{creado} responde 403", r.status == 403, r)
    else:
        r = http("DELETE", "/clientes/999999", token=CTX.t_editor)
        c.paso("Editor: DELETE /clientes/999999 responde 403 (antes de buscar el registro)", r.status == 403, r)
    body, ct = multipart({"cliente_id": CTX.cliente_a, "titulo": "Contrato editor", "fecha_inicio": "2026-01-01",
                          "fecha_fin": "2026-12-31"}, {})
    r = http("POST", "/contratos", raw=body, content_type=ct, token=CTX.t_editor)
    c.paso("Editor: POST /contratos responde 403", r.status == 403, r)
    r = http("POST", "/clientes", {"nombre": f"Cliente Admin {SFX}", "correo": f"admin_{SFX}@cliente.cl",
                                    "telefono": "+56955556666", "direccion": "Calle 2"}, token=CTX.t_admin)
    c.paso("Control positivo: el administrador sí crea clientes (201)", r.status == 201, r)


@caso("CP-05", "Tiempo de respuesta de operaciones CRUD", "NFR-PERF-1",
      "Rendimiento", "p95 menor a 300 ms en 20 lecturas secuenciales de /clientes, /contratos y /metricas.")
def cp05(c):
    for ruta in ("/clientes", "/contratos", "/metricas"):
        tiempos = []
        for _ in range(20):
            r = http("GET", ruta, token=CTX.t_admin)
            tiempos.append(r.ms)
        tiempos.sort()
        p95 = tiempos[int(len(tiempos) * 0.95) - 1]
        c.paso(f"GET {ruta}: p95 menor a 300 ms", p95 < 300 and r.status == 200,
               obtenido=f"20 mediciones · mediana {statistics.median(tiempos):.0f} ms · p95 {p95:.0f} ms · máx {max(tiempos):.0f} ms · HTTP {r.status}")


@caso("CP-06", "Eliminación lógica de clientes, paginación y auditoría", "RF-4.2, RF-6.1",
      "Funcional", "DELETE responde 200/204; luego el cliente responde 404 pero el registro se conserva en la base marcado como eliminado; "
      "queda registro de auditoría; el listado expone X-Total-Count.")
def cp06(c):
    r = http("POST", "/clientes", {"nombre": f"Cliente Eliminar {SFX}", "correo": f"eliminar_{SFX}@cliente.cl",
                                    "telefono": "+56977778888", "direccion": "Calle 3"}, token=CTX.t_admin)
    cid = r.json.get("id") if isinstance(r.json, dict) else None
    c.paso("Se crea un cliente de prueba (201)", r.status == 201 and cid, r)
    r = http("DELETE", f"/clientes/{cid}", token=CTX.t_admin)
    c.paso("DELETE /clientes/:id responde 200 o 204", r.status in (200, 204), r)
    r = http("GET", f"/clientes/{cid}", token=CTX.t_admin)
    c.paso("El cliente eliminado ya no se muestra (404)", r.status == 404, r)
    existe = psql(f"SELECT count(*) FROM clientes WHERE id = {int(cid)}")
    c.paso("El registro se conserva en la base de datos (baja lógica)", existe == "1",
           obtenido=f"{existe} registro(s) con id {cid} en la tabla clientes",
           consulta=f"SELECT count(*) FROM clientes WHERE id = {cid}")
    aud = psql(f"SELECT count(*) FROM auditoria WHERE accion LIKE 'CLIENTES_ELIMINAR%' AND accion LIKE '%{int(cid)}%'")
    c.paso("La eliminación queda registrada en auditoría", int(aud or 0) > 0,
           obtenido=f"{aud} registro(s) CLIENTES_ELIMINAR para el id {cid}")
    r = http("GET", "/clientes?pagina=1&limite=1", token=CTX.t_admin)
    tam = len(r.json) if isinstance(r.json, list) else None
    c.paso("El listado paginado entrega 1 elemento y la cabecera X-Total-Count", tam == 1 and "x-total-count" in r.headers, r,
           obtenido=f"HTTP {r.status} · elementos: {tam} · X-Total-Count: {r.headers.get('x-total-count')}")


@caso("CP-09", "Registro de usuario y creación de empresa", "RF-2.1, RF-2.2, RF-2.3, RB-1, ERS 2.4",
      "Funcional / Reglas de negocio", "Registro válido 201 con rol administrador; contraseña débil 400; "
      "correo de empresa duplicado rechazado sin dejar registros parciales.")
def cp09(c):
    c.paso("Registro válido de usuario y empresa responde 201", CTX.reg_b.status == 201, CTX.reg_b)
    rol = psql(f"SELECT r.nombre FROM empresa_usuarios eu JOIN usuarios u ON u.id = eu.usuario_id "
               f"JOIN roles r ON r.id = eu.rol_id WHERE u.nombre_usuario = '{CTX.usuario_b}'")
    c.paso("El primer usuario de la empresa obtiene el rol administrador", rol == "administrador",
           obtenido=f"rol asignado: «{rol}»")
    r = registrar({
        "usuario": {"nombre_usuario": f"debil_{SFX}", "contrasena_hash": "123", "correo": f"debil_{SFX}@prueba.cl"},
        "empresa": {"nombre": f"Empresa Débil {SFX}", "correo": f"debil_emp_{SFX}@prueba.cl"},
        "acepta_politica": True})
    c.paso("Contraseña débil («123») se rechaza con 400", r.status == 400, r)
    antes = psql("SELECT count(*) FROM usuarios")
    r = registrar({
        "usuario": {"nombre_usuario": f"dup_{SFX}", "contrasena_hash": CLAVE_FUERTE, "correo": f"dup_{SFX}@prueba.cl"},
        "empresa": {"nombre": "Empresa duplicada", "correo": f"empresab_{SFX}@prueba.cl"},
        "acepta_politica": True})
    despues = psql("SELECT count(*) FROM usuarios")
    c.paso("Correo de empresa duplicado se rechaza (400 o 409)", r.status in (400, 409), r)
    c.paso("No quedan registros parciales (operación atómica)", antes == despues,
           obtenido=f"usuarios antes: {antes} · después: {despues}",
           consulta="SELECT count(*) FROM usuarios  (antes y después del registro fallido)")


@caso("CP-10", "Gestión de usuarios y roles de la empresa", "RF-3.1, RF-3.3, RB-2",
      "Funcional / Reglas de negocio", "El administrador crea (201), modifica (200) y elimina (200/204) usuarios de su empresa; "
      "el usuario eliminado no inicia sesión (401); otra empresa no accede a sus datos (403/404).")
def cp10(c):
    nombre = f"editor_qa_{SFX}"
    r = http("POST", "/empresa-usuarios", {"nombre_usuario": nombre, "contrasena_hash": CLAVE_FUERTE,
                                           "correo": f"{nombre}@prueba.cl", "rol_id": 2}, token=CTX.t_admin)
    c.paso("Administrador crea un usuario editor (201)", r.status == 201, r)
    uid = psql(f"SELECT id FROM usuarios WHERE nombre_usuario = '{nombre}'")
    r, t = login(nombre, CLAVE_FUERTE)
    c.paso("El usuario creado puede iniciar sesión", r.status == 200 and bool(t), r)
    r = http("PUT", f"/usuarios/{uid}", {"correo": f"{nombre}_mod@prueba.cl"}, token=CTX.t_admin)
    c.paso("Administrador modifica solo el correo del usuario (200), como lo hace la pantalla Usuarios", r.status == 200, r)
    if CTX.t_b:
        r = http("GET", f"/usuarios/{uid}", token=CTX.t_b)
        c.paso("Administrador de otra empresa no puede consultar el usuario (403/404)", r.status in (403, 404), r)
    r = http("DELETE", f"/usuarios/{uid}", token=CTX.t_admin)
    c.paso("Administrador elimina el usuario (200/204)", r.status in (200, 204), r)
    r, t = login(nombre, CLAVE_FUERTE)
    c.paso("El usuario eliminado no puede iniciar sesión (401)", r.status == 401, r)


@caso("CP-11", "Validación de campos de clientes en el servidor", "RF-4.1, RF-4.3",
      "Funcional / Validación", "Datos válidos 201; correo, teléfono, RUT inválidos o nombre vacío responden 400 indicando el campo; "
      "ningún registro inválido se guarda.", owasp="ASVS V5")
def cp11(c):
    antes = int(psql("SELECT count(*) FROM clientes"))
    r = http("POST", "/clientes", {"nombre": f"Cliente Válido {SFX}", "correo": f"valido_{SFX}@cliente.cl",
                                    "telefono": "+56912345678", "direccion": "Av. Siempre Viva 742",
                                    "rut": "11.111.111-1"}, token=CTX.t_admin)
    c.paso("Cliente con datos válidos se crea (201)", r.status == 201, r)
    invalidos = [
        ("correo sin formato", {"nombre": "Cliente Validación", "correo": "contacto-sin-arroba", "telefono": "+56912345678"}),
        ("teléfono con letras", {"nombre": "Cliente Validación", "correo": f"tel_{SFX}@cliente.cl", "telefono": "12-34-abc"}),
        ("nombre vacío", {"nombre": "", "correo": f"vacio_{SFX}@cliente.cl", "telefono": "+56912345678"}),
        ("RUT con dígito verificador incorrecto", {"nombre": "Cliente RUT", "correo": f"rut_{SFX}@cliente.cl",
                                                   "telefono": "+56912345678", "rut": "11.111.111-2"}),
    ]
    for desc, datos in invalidos:
        r = http("POST", "/clientes", datos, token=CTX.t_admin)
        c.paso(f"Cliente con {desc} se rechaza con 400", r.status == 400, r)
    despues = int(psql("SELECT count(*) FROM clientes"))
    c.paso("Solo se guardó el cliente válido", despues - antes == 1,
           obtenido=f"clientes antes: {antes} · después: {despues} (diferencia {despues - antes})")


@caso("CP-12", "Contratos, documentos, estado y enlace para compartir", "RF-5.1 a RF-5.5, RB-3",
      "Funcional / Reglas de negocio", "Contrato con PDF 201; archivo .exe 400/415; archivo de 11 MB 413; cliente de otra empresa 400/404; "
      "el listado informa el estado (activo/vence/expirado); el enlace para compartir funciona sin sesión y vence.",
      owasp="A04:2021 · CWE-434")
def cp12(c):
    c.paso("Se crea un contrato con documento PDF (201)", bool(CTX.contrato_a), obtenido=f"contrato id {CTX.contrato_a}")
    body, ct = multipart({"cliente_id": CTX.cliente_a, "titulo": "Contrato con exe", "fecha_inicio": "2026-01-01",
                          "fecha_fin": "2026-12-31"}, {"file": ("malware.exe", EXE, "application/x-msdownload")})
    r = http("POST", "/contratos", raw=body, content_type=ct, token=CTX.t_admin)
    c.paso("Documento .exe se rechaza (400 o 415)", r.status in (400, 415), r)
    body, ct = multipart({"cliente_id": CTX.cliente_a, "titulo": "Contrato exe disfrazado", "fecha_inicio": "2026-01-01",
                          "fecha_fin": "2026-12-31"}, {"file": ("factura.pdf", EXE, "application/pdf")})
    r = http("POST", "/contratos", raw=body, content_type=ct, token=CTX.t_admin)
    c.paso("Ejecutable renombrado a .pdf se rechaza por su contenido (400 o 415)", r.status in (400, 415), r)
    grande = PDF + b"0" * (11 * 1024 * 1024)
    body, ct = multipart({"cliente_id": CTX.cliente_a, "titulo": "Contrato grande", "fecha_inicio": "2026-01-01",
                          "fecha_fin": "2026-12-31"}, {"file": ("grande.pdf", grande, "application/pdf")})
    r = http("POST", "/contratos", raw=body, content_type=ct, token=CTX.t_admin)
    c.paso("Documento de 11 MB se rechaza con 413", r.status == 413, r)
    if CTX.t_b:
        body, ct = multipart({"cliente_id": CTX.cliente_a, "titulo": "Contrato cruzado", "fecha_inicio": "2026-01-01",
                              "fecha_fin": "2026-12-31"}, {})
        r = http("POST", "/contratos", raw=body, content_type=ct, token=CTX.t_b)
        c.paso("Empresa B no puede crear contratos para un cliente de la empresa A (400/403/404)", r.status in (400, 403, 404), r)
    r = http("GET", f"/contratos/{CTX.contrato_a}/file", token=CTX.t_admin)
    c.paso("El administrador descarga el documento (200, application/pdf)",
           r.status == 200 and "pdf" in r.headers.get("content-type", ""), r)
    r = http("GET", "/contratos", token=CTX.t_admin)
    estados = {x.get("estado") for x in (r.json or []) if isinstance(x, dict)} if isinstance(r.json, list) else set()
    c.paso("Cada contrato del listado informa su estado (activo, vence o expirado)",
           bool(estados) and estados <= {"activo", "vence", "expirado"}, r,
           obtenido=f"HTTP {r.status} · estados encontrados: {sorted(str(e) for e in estados)}")
    r = http("POST", f"/contratos/{CTX.contrato_a}/enlace", {"minutos": 1}, token=CTX.t_admin)
    url = (r.json or {}).get("url") if isinstance(r.json, dict) else None
    c.paso("Se genera un enlace para compartir con vigencia limitada (201)", r.status == 201 and bool(url), r)
    if url:
        r2 = http("GET", url if url.startswith("http") else API + url)
        c.paso("El enlace entrega el documento sin iniciar sesión (200)", r2.status == 200, r2)
        alterado = url[:-3] + ("aaa" if not url.endswith("aaa") else "bbb")
        r3 = http("GET", alterado if alterado.startswith("http") else API + alterado)
        c.paso("Un enlace alterado se rechaza (403/404)", r3.status in (401, 403, 404), r3)


@caso("CP-13", "Cierre de sesión y revocación del token", "RF-1.2, NFR-SEG-9",
      "Funcional / Seguridad", "POST /autenticacion/logout responde 200/204 y el mismo token responde 401 después.",
      owasp="A07:2021 · CWE-613")
def cp13(c):
    r, t = login(*ADMIN)
    r = http("GET", "/clientes", token=t)
    c.paso("Con el token recién emitido, GET /clientes responde 200", r.status == 200, r)
    r = http("POST", "/autenticacion/logout", token=t)
    c.paso("POST /autenticacion/logout responde 200 o 204", r.status in (200, 204), r)
    r = http("GET", "/clientes", token=t)
    c.paso("El token revocado ya no se acepta (401)", r.status == 401, r)


@caso("CP-14", "Cifrado en tránsito (TLS/HSTS) y cifrado en reposo de datos bancarios", "NFR-SEG-1, NFR-SEG-3",
      "Seguridad", "La API se sirve por HTTPS; HTTP redirige a HTTPS (301/308); HSTS con max-age ≥ 31.536.000; TLS ≥ 1.2; "
      "el número de cuenta no se guarda legible en la base y la lectura autorizada lo devuelve correcto.",
      owasp="A02:2021 · CWE-319 · CWE-311")
def cp14(c):
    c.paso("La API se sirve por HTTPS", API.startswith("https://"), obtenido=f"API_URL = {API}")
    try:
        r = http("GET", HTTP_FRONT + "/", base="")
        loc = r.headers.get("location", "")
        c.paso("Una solicitud HTTP se redirige a HTTPS (301/308)", r.status in (301, 308) and loc.startswith("https://"), r,
               obtenido=f"HTTP {r.status} · Location: {loc or '(sin redirección)'}")
    except Exception as e:
        c.paso("Una solicitud HTTP se redirige a HTTPS (301/308)", False, obtenido=f"Error: {e}")
    r = http("GET", "/", token=CTX.t_admin)
    hsts = r.headers.get("strict-transport-security", "")
    m = re.search(r"max-age=(\d+)", hsts)
    c.paso("La respuesta incluye HSTS con max-age ≥ 31.536.000", bool(m) and int(m.group(1)) >= 31536000, r,
           obtenido=f"Strict-Transport-Security: {hsts or '(ausente)'}")
    if API.startswith("https://"):
        import socket
        host = API.split("//")[1].split("/")[0]
        h, _, p = host.partition(":")
        with socket.create_connection((h, int(p or 443)), timeout=10) as s:
            with SSL_CTX.wrap_socket(s, server_hostname=h) as ss:
                ver = ss.version()
        c.paso("La conexión negocia TLS 1.2 o superior", ver in ("TLSv1.2", "TLSv1.3"), obtenido=f"Protocolo negociado: {ver}")
    cuenta = f"9{SFX}"
    r = http("POST", "/clientes", {"nombre": f"Cliente Banco {SFX}", "correo": f"banco_{SFX}@cliente.cl",
                                    "telefono": "+56911223344", "direccion": "Calle 4", "nombre_banco": "Banco de Prueba",
                                    "numero_cuenta": cuenta, "titular_cuenta": "Titular Prueba"}, token=CTX.t_admin)
    cid = r.json.get("id") if isinstance(r.json, dict) else None
    guardado = psql(f"SELECT numero_cuenta FROM clientes WHERE id = {int(cid)}") if cid else ""
    c.paso("El número de cuenta no se guarda legible en la base de datos", bool(guardado) and cuenta not in guardado,
           obtenido=f"Valor enviado: {cuenta} · valor almacenado: «{guardado[:60]}»",
           consulta=f"SELECT numero_cuenta FROM clientes WHERE id = {cid}")
    r = http("GET", f"/clientes/{cid}", token=CTX.t_admin)
    leido = (r.json or {}).get("numero_cuenta") if isinstance(r.json, dict) else None
    c.paso("La lectura autorizada devuelve el número de cuenta correcto", leido == cuenta, r,
           obtenido=f"HTTP {r.status} · numero_cuenta devuelto: {leido}")


@caso("CP-15", "Protección de entradas: inyección SQL, XSS y errores sin detalles internos", "NFR-SEG-5",
      "Seguridad", "Inyección SQL no altera consultas ni provoca error 500; un script en un campo de texto se rechaza (400); "
      "los errores no muestran detalles de la base de datos.", owasp="A03:2021 · CWE-89 · CWE-79 · CWE-209")
def cp15(c):
    r, t = login("admin' OR '1'='1", "x' OR '1'='1")
    c.paso("Inyección SQL en el login no permite ingresar (401)", r.status == 401 and not t, r)
    total = http("GET", "/clientes/search?name=", token=CTX.t_admin)
    r = http("GET", "/clientes/search?name=" + urllib.request.quote("' OR '1'='1"), token=CTX.t_admin)
    n_total = len(total.json) if isinstance(total.json, list) else -1
    n_iny = len(r.json) if isinstance(r.json, list) else -1
    c.paso("Inyección SQL en la búsqueda no devuelve registros adicionales", r.status == 200 and n_iny == 0, r,
           obtenido=f"HTTP {r.status} · filas con payload: {n_iny} · filas totales de la empresa: {n_total}")
    r = http("GET", "/contratos/1%20OR%201=1", token=CTX.t_admin)
    c.paso("Inyección en un parámetro de ruta no provoca error 500 ni detalles internos (400/404)",
           r.status in (400, 404) and not PATRONES_INTERNOS.search(str(r.body)), r)
    payload = "<script>alert('xss')</script>"
    r = http("POST", "/clientes", {"nombre": payload, "correo": f"xss_{SFX}@cliente.cl", "telefono": "+56912121212",
                                    "direccion": "<img src=x onerror=alert(1)>"}, token=CTX.t_admin)
    c.paso("Un script en el nombre del cliente se rechaza (400) y no se almacena", r.status == 400, r)
    r = http("POST", "/clientes", {"nombre": f"Cliente Dup {SFX}", "correo": f"qa_{SFX}@cliente.cl",
                                    "telefono": "+56912121212", "direccion": "Calle 5"}, token=CTX.t_admin)
    c.paso("Un correo duplicado responde 409 sin detalles de la base de datos",
           r.status == 409 and not PATRONES_INTERNOS.search(str(r.body)), r)


@caso("CP-16", "Respaldo y restauración de la base de datos", "NFR-SEG-7, NFR-DIS-2",
      "Mantenimiento / Continuidad", "pg_dump genera el respaldo sin errores y la restauración en una base limpia reproduce los mismos conteos por tabla.",
      herramienta="pg_dump / pg_restore (PostgreSQL) vía docker exec")
def cp16(c):
    tablas = ["usuarios", "empresas", "empresa_usuarios", "clientes", "contratos", "documentos_contrato", "auditoria"]
    rc, out = docker("exec", DB_CONTAINER, "sh", "-c", "pg_dump -U postgres -Fc atlas -f /tmp/atlas_respaldo.dump && ls -l /tmp/atlas_respaldo.dump")
    c.paso("pg_dump genera el respaldo sin errores", rc == 0, obtenido=out.strip()[-200:])
    rc, out = docker("exec", DB_CONTAINER, "sh", "-c",
                     "dropdb -U postgres --if-exists atlas_restaurada && createdb -U postgres atlas_restaurada && "
                     "pg_restore -U postgres -d atlas_restaurada /tmp/atlas_respaldo.dump && echo OK")
    c.paso("pg_restore restaura el respaldo en una base limpia", rc == 0 and "OK" in out, obtenido=out.strip()[-200:])
    difs = []
    detalle = []
    for t in tablas:
        _, a = docker("exec", DB_CONTAINER, "psql", "-U", "postgres", "-d", "atlas", "-t", "-A", "-c", f"SELECT count(*) FROM {t}")
        _, b = docker("exec", DB_CONTAINER, "psql", "-U", "postgres", "-d", "atlas_restaurada", "-t", "-A", "-c", f"SELECT count(*) FROM {t}")
        detalle.append(f"{t}: {a.strip()}/{b.strip()}")
        if a.strip() != b.strip():
            difs.append(t)
    c.paso("Los conteos por tabla son idénticos (origen/restaurada)", not difs, obtenido=" · ".join(detalle))
    docker("exec", DB_CONTAINER, "dropdb", "-U", "postgres", "--if-exists", "atlas_restaurada")


@caso("CP-20", "Cumplimiento normativo en el registro (Ley 19.628 y Ley 21.719)", "NFR-SEG-8",
      "Cumplimiento normativo", "El servidor exige la aceptación de la política de privacidad para registrar datos personales (400 sin ella); "
      "la política es accesible.", owasp="Ley 21.719 art. 12 (consentimiento)")
def cp20(c):
    r = registrar({
        "usuario": {"nombre_usuario": f"sinconsent_{SFX}", "contrasena_hash": CLAVE_FUERTE, "correo": f"sinconsent_{SFX}@prueba.cl"},
        "empresa": {"nombre": f"Empresa sin consentimiento {SFX}", "correo": f"sinconsent_emp_{SFX}@prueba.cl"}})
    c.paso("Registro sin aceptar la política de privacidad se rechaza (400)", r.status == 400, r)
    creado = psql(f"SELECT count(*) FROM usuarios WHERE nombre_usuario = 'sinconsent_{SFX}'")
    c.paso("No se guardan datos personales sin consentimiento", creado == "0",
           obtenido=f"{creado} usuario(s) creados sin consentimiento")
    c.nota = "La visibilidad del aviso de privacidad y la casilla de consentimiento en la pantalla de registro se verifican con Playwright (CP-20 UI)."


# --------------------------------------------------------------------------
# PRUEBAS ADICIONALES DE SEGURIDAD (OWASP Top 10 / ASVS)
# --------------------------------------------------------------------------

ENDPOINTS_PROTEGIDOS = [
    ("GET", "/usuarios"), ("GET", "/usuarios/1"), ("POST", "/usuarios"), ("PUT", "/usuarios/999999"),
    ("DELETE", "/usuarios/999999"), ("GET", "/clientes"), ("GET", "/clientes/1"), ("POST", "/clientes"),
    ("GET", "/contratos"), ("GET", "/contratos/1"), ("GET", "/contratos/1/file"), ("POST", "/contratos"),
    ("DELETE", "/contratos/999999"), ("GET", "/empresas"), ("GET", "/empresas/1"), ("PUT", "/empresas/999999"),
    ("DELETE", "/empresas/999999"), ("GET", "/roles"), ("POST", "/roles"), ("PUT", "/roles/999999"),
    ("DELETE", "/roles/999999"), ("GET", "/empresa-usuarios"), ("GET", "/empresa-usuarios/1"),
    ("PUT", "/empresa-usuarios/999999"), ("DELETE", "/empresa-usuarios/999999"), ("GET", "/auditoria"),
    ("POST", "/auditoria"), ("GET", "/metricas"),
]


@caso("SEG-01", "Autenticación obligatoria en todos los endpoints no públicos", "NFR-SEG-4",
      "Seguridad (control de acceso)", "Todas las rutas, salvo el inicio de sesión y el registro, responden 401 sin token "
      f"({len(ENDPOINTS_PROTEGIDOS)} rutas verificadas). Para métodos destructivos se usa un id inexistente.",
      owasp="A01:2021 · CWE-306")
def seg01(c):
    for metodo, ruta in ENDPOINTS_PROTEGIDOS:
        body = {} if metodo in ("POST", "PUT") else None
        r = http(metodo, ruta, body)
        c.paso(f"{metodo} {ruta} sin token responde 401", r.status == 401, r)


@caso("SEG-02", "Aislamiento entre empresas (multiempresa / IDOR)", "RB-2, NFR-SEG-4",
      "Seguridad (control de acceso)", "Con el token de la empresa B no se puede leer, descargar ni eliminar información de la empresa A (403/404).",
      owasp="A01:2021 · CWE-639")
def seg02(c):
    if not CTX.t_b:
        raise RuntimeError("No se pudo crear o iniciar sesión con la empresa B")
    for ruta in (f"/contratos/{CTX.contrato_a}", f"/contratos/{CTX.contrato_a}/file", "/empresas/1", "/usuarios/1",
                 "/empresa-usuarios/1", f"/clientes/{CTX.cliente_a}"):
        r = http("GET", ruta, token=CTX.t_b)
        c.paso(f"Empresa B: GET {ruta} responde 403/404", r.status in (403, 404), r)
    r = http("GET", "/empresas", token=CTX.t_b)
    otras = [e for e in (r.json or []) if isinstance(e, dict) and str(e.get("id")) == "1"] if isinstance(r.json, list) else []
    c.paso("Empresa B: GET /empresas no lista la empresa A", r.status in (200, 403) and not otras, r,
           obtenido=f"HTTP {r.status} · empresas ajenas visibles: {len(otras)}")
    r = http("GET", "/auditoria", token=CTX.t_b)
    ajenos = [a for a in (r.json or []) if isinstance(a, dict) and a.get("usuario_id") in ("admin", "editor")] if isinstance(r.json, list) else []
    c.paso("Empresa B: GET /auditoria no muestra acciones de la empresa A", not ajenos, r,
           obtenido=f"HTTP {r.status} · registros de la empresa A visibles: {len(ajenos)}")
    r = http("DELETE", f"/contratos/{CTX.contrato_a}", token=CTX.t_b)
    c.paso("Empresa B: DELETE del contrato de la empresa A responde 403/404", r.status in (403, 404), r)
    queda = psql(f"SELECT count(*) FROM contratos WHERE id = {int(CTX.contrato_a)}")
    c.paso("El contrato de la empresa A sigue existiendo", queda == "1", obtenido=f"{queda} contrato(s) con id {CTX.contrato_a}")


@caso("SEG-03", "Escalamiento de privilegios", "RF-3.2, RB-4, NFR-SEG-4",
      "Seguridad (control de acceso)", "Ni el editor ni un visitante sin token pueden crear administradores ni cambiar roles (401/403); "
      "el rol en la base no cambia.", owasp="A01:2021 · CWE-269")
def seg03(c):
    nombre = f"esc_{SFX}"
    r = http("POST", "/empresa-usuarios", {"nombre_usuario": nombre, "contrasena_hash": CLAVE_FUERTE,
                                           "correo": f"{nombre}@prueba.cl", "rol_id": 1}, token=CTX.t_editor)
    c.paso("Editor: crear un usuario administrador responde 403", r.status == 403, r)
    creado = psql(f"SELECT count(*) FROM usuarios WHERE nombre_usuario = '{nombre}'")
    c.paso("No se creó el usuario administrador", creado == "0", obtenido=f"{creado} usuario(s) «{nombre}» en la base")
    victima = f"victima_{SFX}"
    http("POST", "/empresa-usuarios", {"nombre_usuario": victima, "contrasena_hash": CLAVE_FUERTE,
                                       "correo": f"{victima}@prueba.cl", "rol_id": 2}, token=CTX.t_admin)
    fila = psql(f"SELECT eu.id, eu.empresa_id, eu.usuario_id FROM empresa_usuarios eu JOIN usuarios u ON u.id = eu.usuario_id "
                f"WHERE u.nombre_usuario = '{victima}'")
    if fila:
        eu_id, emp, uid = fila.split("|")
        r = http("PUT", f"/empresa-usuarios/{eu_id}", {"empresa_id": int(emp), "usuario_id": int(uid), "rol_id": 1})
        c.paso(f"Visitante sin token: PUT /empresa-usuarios/{eu_id} con rol_id=1 responde 401", r.status == 401, r)
        rol = psql(f"SELECT rol_id FROM empresa_usuarios WHERE id = {int(eu_id)}")
        c.paso("El rol del usuario sigue siendo editor (rol_id = 2)", rol == "2", obtenido=f"rol_id actual: {rol}")
    r = http("POST", "/roles", {"nombre": f"superadmin_{SFX}"})
    c.paso("Visitante sin token: POST /roles responde 401", r.status == 401, r)


@caso("SEG-04", "Protección contra fuerza bruta en el inicio de sesión", "ERS 2.4, NFR-SEG-9",
      "Seguridad", "Tras 5 intentos fallidos en la ventana de tiempo, el servidor responde 429 (Too Many Requests).",
      owasp="A07:2021 · CWE-307")
def seg04(c):
    objetivo = f"objetivo_fb_{SFX}"
    r = http("POST", "/empresa-usuarios", {"nombre_usuario": objetivo, "contrasena_hash": CLAVE_FUERTE,
                                           "correo": f"{objetivo}@prueba.cl", "rol_id": 2}, token=CTX.t_admin)
    c.paso(f"Se crea el usuario objetivo «{objetivo}» (201)", r.status == 201, r)

    def intento(i):
        return http("POST", "/autenticacion/login", {"nombre_usuario": objetivo, "password": f"fuerza_bruta_{i}"})
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as ex:
        resps = list(ex.map(intento, range(8)))
    codigos = [r.status for r in resps]
    bloqueado = next((r for r in resps if r.status == 429), resps[-1])
    c.paso("8 intentos fallidos: al menos uno responde 429", 429 in codigos,
           bloqueado, obtenido=f"Códigos obtenidos: {codigos}")
    r, t = login(objetivo, CLAVE_FUERTE)
    c.paso("Durante el bloqueo, incluso la contraseña correcta responde 429", r.status == 429, r)
    c.nota = "Los intentos se enviaron en paralelo con 8 hilos contra un usuario creado para la prueba."


@caso("SEG-05", "Divulgación de información técnica", "NFR-SEG-5",
      "Seguridad (configuración)", "Las respuestas no exponen la tecnología (X-Powered-By) ni mensajes internos de PostgreSQL o trazas.",
      owasp="A05:2021 · CWE-200 · CWE-209")
def seg05(c):
    r = http("GET", "/", token=CTX.t_admin)
    c.paso("La API no envía la cabecera X-Powered-By", "x-powered-by" not in r.headers, r,
           obtenido=f"X-Powered-By: {r.headers.get('x-powered-by', '(ausente)')}")
    r = http("GET", "/contratos/abc", token=CTX.t_admin)
    c.paso("Un identificador inválido no devuelve el mensaje de PostgreSQL",
           not PATRONES_INTERNOS.search(str(r.body)) and r.status != 500, r)
    r = http("POST", "/empresa-usuarios", {"usuario_id": 999999, "rol_id": 2}, token=CTX.t_admin)
    c.paso("Una referencia inexistente no devuelve el mensaje de PostgreSQL",
           not PATRONES_INTERNOS.search(str(r.body)) and r.status != 500, r)
    r = http("GET", "/", base=FRONT)
    srv = r.headers.get("server", "")
    c.paso("El servidor web del frontend no informa su versión", not re.search(r"\d", srv), r,
           obtenido=f"Server: {srv or '(ausente)'}")


@caso("SEG-06", "Integridad y confidencialidad del registro de auditoría", "RF-6.1, NFR-SEG-6",
      "Seguridad (registro y monitoreo)", "Nadie puede escribir registros de auditoría arbitrarios por la API; "
      "solo el administrador consulta la auditoría de su empresa.", owasp="A09:2021 · CWE-117")
def seg06(c):
    antes = psql("SELECT count(*) FROM auditoria")
    r = http("POST", "/auditoria", {"accion": "LOGIN", "detalles": "registro falsificado por un visitante"})
    c.paso("Visitante sin token no puede insertar registros de auditoría (401/404/405)", r.status in (401, 404, 405), r)
    r = http("POST", "/auditoria", {"accion": "CLIENTES_ELIMINAR", "detalles": "registro falso del editor"}, token=CTX.t_editor)
    c.paso("El editor no puede insertar registros de auditoría arbitrarios (403/404/405)", r.status in (403, 404, 405), r)
    despues = psql("SELECT count(*) FROM auditoria")
    c.paso("La tabla auditoria no recibió registros falsificados", antes == despues,
           obtenido=f"registros antes: {antes} · después: {despues}")
    r = http("GET", "/auditoria", token=CTX.t_editor)
    c.paso("El editor no puede consultar la auditoría (403)", r.status == 403, r)
    r = http("GET", "/auditoria", token=CTX.t_admin)
    c.paso("El administrador sí consulta la auditoría de su empresa (200)", r.status == 200, r)


@caso("SEG-07", "Política CORS restringida", "NFR-SEG-5",
      "Seguridad (configuración)", "Un origen no autorizado no recibe Access-Control-Allow-Origin; el origen del frontend sí.",
      owasp="A05:2021 · CWE-942")
def seg07(c):
    hdr = {"Origin": "https://sitio-malicioso.example", "Access-Control-Request-Method": "GET",
           "Access-Control-Request-Headers": "authorization"}
    r = http("OPTIONS", "/clientes", headers=hdr)
    acao = r.headers.get("access-control-allow-origin")
    c.paso("Preflight desde un origen no autorizado: sin Access-Control-Allow-Origin", acao in (None, ""), r,
           obtenido=f"Access-Control-Allow-Origin: {acao or '(ausente)'}")
    r = http("GET", "/clientes", token=CTX.t_admin, headers={"Origin": "https://sitio-malicioso.example"})
    acao = r.headers.get("access-control-allow-origin")
    c.paso("GET autenticado desde un origen no autorizado: sin Access-Control-Allow-Origin", acao in (None, ""), r,
           obtenido=f"Access-Control-Allow-Origin: {acao or '(ausente)'}")


CABECERAS = ["content-security-policy", "x-content-type-options", "x-frame-options", "referrer-policy",
             "strict-transport-security"]


@caso("SEG-08", "Cabeceras de seguridad HTTP en el frontend y la API", "NFR-SEG-1, NFR-SEG-5",
      "Seguridad (configuración)", "Frontend y API envían CSP, X-Content-Type-Options, X-Frame-Options, Referrer-Policy y HSTS.",
      owasp="A05:2021 · OWASP Secure Headers")
def seg08(c):
    for nombre, url in (("Frontend", FRONT + "/"), ("API", API + "/")):
        r = http("GET", url, base="")
        faltan = [h for h in CABECERAS if h not in r.headers]
        c.paso(f"{nombre}: cabeceras de seguridad presentes", not faltan, r,
               obtenido="Faltan: " + (", ".join(faltan) if faltan else "ninguna"))


@caso("SEG-09", "Manipulación del token JWT", "NFR-SEG-9",
      "Seguridad (autenticación)", "Se rechazan (401) los tokens sin firma (alg none), con firma de un secreto débil conocido, "
      "con el payload alterado y vencidos.", owasp="A02:2021 · A07:2021 · CWE-347")
def seg09(c):
    p = dict(jwt_payload(CTX.t_admin) or {})
    ahora = int(time.time())
    base = {"usuarioId": p.get("usuarioId", 1), "nombreUsuario": "admin", "empresaId": p.get("empresaId", 1),
            "iat": ahora, "exp": ahora + 3600}
    t_none = jwt_firmar(base, "", alg="none")
    r = http("GET", "/clientes", token=t_none)
    c.paso("Token con alg «none» (sin firma) responde 401", r.status == 401, r)
    t_debil = jwt_firmar(base, "inseguro")
    r = http("GET", "/clientes", token=t_debil)
    c.paso("Token firmado con el secreto por defecto del código («inseguro») responde 401", r.status == 401, r)
    cab, cue, fir = CTX.t_admin.split(".")
    p2 = dict(p)
    p2["empresaId"] = 999
    t_alt = f"{cab}.{b64url(json.dumps(p2).encode())}.{fir}"
    r = http("GET", "/clientes", token=t_alt)
    c.paso("Token con empresaId alterado y firma original responde 401", r.status == 401, r)
    rc, secreto = docker("exec", API_CONTAINER, "printenv", "JWT_SECRET")
    secreto = secreto.strip()
    if rc == 0 and secreto:
        venc = dict(p)
        venc["iat"], venc["exp"] = ahora - 7200, ahora - 60
        t_venc = jwt_firmar(venc, secreto)
        r = http("GET", "/clientes", token=t_venc)
        c.paso("Token vencido (exp en el pasado) responde 401", r.status == 401, r)
    longitud = len(secreto)
    c.paso("El secreto de firma configurado tiene al menos 32 caracteres", longitud >= 32,
           obtenido=f"Largo del secreto: {longitud} caracteres (valor no registrado)")


@caso("SEG-10", "Los logs no registran contraseñas ni tokens", "NFR-SEG-6, ERS 2.4",
      "Seguridad (registro y monitoreo)", "Los logs del backend no contienen las contraseñas usadas en las pruebas ni tokens JWT.",
      owasp="A09:2021 · CWE-532", herramienta="docker logs + búsqueda de patrones")
def seg10(c):
    rc, logs = docker("logs", API_CONTAINER, timeout=60)
    claves = [CLAVE_FUERTE, "fuerza_bruta_"]
    hallazgos = [k for k in claves if k in logs]
    c.paso("Los logs no contienen contraseñas de prueba", not hallazgos,
           obtenido=f"{len(logs.splitlines())} líneas revisadas · coincidencias: {hallazgos or 'ninguna'}")
    tokens = re.findall(r"eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}", logs)
    c.paso("Los logs no contienen tokens JWT", not tokens, obtenido=f"tokens encontrados: {len(tokens)}")
    pii = re.findall(r"authUser\s+\{", logs)
    c.paso("Los logs no vuelcan el contenido del token decodificado (authUser)", not pii,
           obtenido=f"líneas «authUser {{...}}»: {len(pii)}")


@caso("SEG-11", "Ejecución de contenedores con mínimo privilegio y base no expuesta", "NFR-SEG-4, ERS 3.1",
      "Seguridad (configuración)", "Backend y frontend no corren como root; PostgreSQL no se publica fuera del host; "
      "la API se conecta a la base con un usuario sin privilegios de superusuario.",
      owasp="A05:2021 · CWE-250", herramienta="docker exec / docker port / psql")
def seg11(c):
    rc, out = docker("exec", API_CONTAINER, "id", "-u")
    c.paso("El proceso del backend no corre como root (uid ≠ 0)", rc == 0 and out.strip() != "0", obtenido=f"uid: {out.strip()}")
    rc, out = docker("exec", FRONT_CONTAINER, "id", "-u")
    c.paso("El proceso del frontend no corre como root (uid ≠ 0)", rc == 0 and out.strip() != "0", obtenido=f"uid: {out.strip()}")
    rc, out = docker("port", DB_CONTAINER)
    expuesto = [l for l in out.splitlines() if "0.0.0.0" in l or "[::]" in l]
    c.paso("PostgreSQL no se publica en todas las interfaces del host", not expuesto,
           obtenido=out.strip() or "(sin puertos publicados)")
    rc, url = docker("exec", API_CONTAINER, "printenv", "DATABASE_URL")
    m = re.match(r"postgres(?:ql)?://([^:@/]+)", url.strip())
    usuario = m.group(1) if m else "?"
    sup = psql(f"SELECT rolsuper FROM pg_roles WHERE rolname = '{usuario}'")
    c.paso("La API usa un usuario de base sin privilegios de superusuario", sup == "f",
           obtenido=f"usuario de conexión: {usuario} · superusuario: {sup}")


# --------------------------------------------------------------------------
# Ejecución
# --------------------------------------------------------------------------


def ejecutar():
    os.makedirs(OUT_DIR, exist_ok=True)
    t0 = datetime.datetime.now()
    print(f"Atlas · suite de seguridad · Ciclo {CICLO} · versión {VERSION_SUT} · API {API}")
    try:
        preparar()
    except Exception as e:
        print("Error al preparar los datos de prueba:", e)
        raise
    resultados = []
    for c, fn in CASOS:
        if SOLO and c.id not in SOLO:
            continue
        c.inicio = datetime.datetime.now().strftime("%d-%m-%Y %H:%M:%S")
        try:
            fn(c)
            c.estado = "PASA" if c.pasos and all(p["ok"] for p in c.pasos) else "FALLA"
        except Exception as e:
            c.estado = "BLOQUEADO"
            c.nota = f"{type(e).__name__}: {e}"
            traceback.print_exc()
        c.fin = datetime.datetime.now().strftime("%d-%m-%Y %H:%M:%S")
        ok = sum(p["ok"] for p in c.pasos)
        print(f"{c.id:7} {c.estado:10} {ok}/{len(c.pasos)} pasos  {c.nombre}")
        resultados.append(c.a_dict())
    resumen = {
        "ciclo": CICLO, "version": VERSION_SUT, "api": API, "frontend": FRONT,
        "inicio": t0.strftime("%d-%m-%Y %H:%M:%S"),
        "fin": datetime.datetime.now().strftime("%d-%m-%Y %H:%M:%S"),
        "total": len(resultados),
        "pasa": sum(r["estado"] == "PASA" for r in resultados),
        "falla": sum(r["estado"] == "FALLA" for r in resultados),
        "bloqueado": sum(r["estado"] == "BLOQUEADO" for r in resultados),
        "pasos_total": sum(len(r["pasos"]) for r in resultados),
        "pasos_ok": sum(sum(p["ok"] for p in r["pasos"]) for r in resultados),
    }
    with open(os.path.join(OUT_DIR, "resultados.json"), "w", encoding="utf-8") as f:
        json.dump({"resumen": resumen, "casos": resultados}, f, ensure_ascii=False, indent=2)
    with open(os.path.join(OUT_DIR, "resumen.md"), "w", encoding="utf-8") as f:
        f.write(f"# Resultados · Ciclo {CICLO} · {VERSION_SUT}\n\n")
        f.write(f"Ejecución: {resumen['inicio']} a {resumen['fin']} · API: {API}\n\n")
        f.write(f"**{resumen['pasa']} de {resumen['total']} casos aprueban** "
                f"({resumen['pasos_ok']} de {resumen['pasos_total']} verificaciones).\n\n")
        f.write("| Caso | Nombre | Requisitos | Estado | Verificaciones |\n|---|---|---|---|---|\n")
        for r in resultados:
            ok = sum(p["ok"] for p in r["pasos"])
            f.write(f"| {r['id']} | {r['nombre']} | {r['requisitos']} | {r['estado']} | {ok}/{len(r['pasos'])} |\n")
    print(f"\nResultado: {resumen['pasa']}/{resumen['total']} casos aprobados · "
          f"{resumen['pasos_ok']}/{resumen['pasos_total']} verificaciones · salida en {OUT_DIR}")
    return 0 if resumen["falla"] == 0 and resumen["bloqueado"] == 0 else 1


if __name__ == "__main__":
    sys.exit(ejecutar())
