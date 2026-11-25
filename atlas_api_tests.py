"""
Suite de pruebas de API de Atlas (casos CP-01 a CP-20 del informe EP3).
Usa solo la librería estándar (unittest + urllib), igual que el informe.

Variables de entorno:
  API_URL        (default http://localhost:4450)
  ADMIN_USER     (default admin)       ADMIN_PASS  (default admin)
  EDITOR_USER    (opcional, para CP-04)  EDITOR_PASS (opcional)
  DATABASE_URL   (opcional, para CP-03; requiere psql en el PATH)

Ejecución:
  python atlas_api_tests.py -v
  python atlas_api_tests.py -v > resultados.txt
"""
import base64, json, os, statistics, subprocess, time, unittest, urllib.error, urllib.parse, urllib.request

API = os.environ.get("API_URL", "http://localhost:4450").rstrip("/")
ADMIN_USER = os.environ.get("ADMIN_USER", "admin")
ADMIN_PASS = os.environ.get("ADMIN_PASS", "admin")
EDITOR_USER = os.environ.get("EDITOR_USER")
EDITOR_PASS = os.environ.get("EDITOR_PASS")
DATABASE_URL = os.environ.get("DATABASE_URL")


def call(method, path, body=None, token=None):
    """Devuelve (status, json_o_texto, segundos)."""
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(API + path, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            raw, status = r.read(), r.status
    except urllib.error.HTTPError as e:
        raw, status = e.read(), e.code
    elapsed = time.perf_counter() - t0
    try:
        payload = json.loads(raw.decode() or "null")
    except ValueError:
        payload = raw.decode(errors="replace")
    return status, payload, elapsed


def login(user, password):
    status, body, _ = call("POST", "/autenticacion/login",
                           {"nombre_usuario": user, "password": password})
    return status, body, (body or {}).get("token") if isinstance(body, dict) else None


def jwt_payload(token):
    seg = token.split(".")[1]
    seg += "=" * (-len(seg) % 4)
    return json.loads(base64.urlsafe_b64decode(seg))


def psql(sql):
    out = subprocess.run(["psql", DATABASE_URL, "-t", "-A", "-c", sql],
                         capture_output=True, text=True, timeout=30)
    if out.returncode != 0:
        raise RuntimeError(out.stderr.strip())
    return out.stdout.strip()


class Base(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.status, cls.body, cls.token = login(ADMIN_USER, ADMIN_PASS)


# ---------- CP-01 ----------
class CP01_LoginExitoso(Base):
    """RF-1.1, NFR-SEG-9: login válido devuelve JWT con claims y expiración de 2 h."""
    def test_login_devuelve_200_y_token(self):
        self.assertEqual(self.status, 200, self.body)
        self.assertIn("token", self.body)  # respuesta real: {"token": ...}

    def test_claims_del_token(self):
        claims = jwt_payload(self.token)
        for k in ("usuarioId", "nombreUsuario", "empresaUsuarioId", "empresaId"):
            self.assertIn(k, claims)
        self.assertEqual(claims["exp"] - claims["iat"], 7200)

    def test_token_permite_consultar_clientes(self):
        status, _, _ = call("GET", "/clientes", token=self.token)
        self.assertEqual(status, 200)


# ---------- CP-02 ----------
class CP02_LoginInvalido(unittest.TestCase):
    """RF-1.1: credenciales inválidas -> 401 con mensaje genérico, sin token."""
    def test_password_incorrecta(self):
        status, body, token = login(ADMIN_USER, "incorrecta123")
        self.assertEqual(status, 401)
        self.assertIsNone(token)

    def test_usuario_inexistente_mismo_mensaje(self):
        s1, b1, _ = login(ADMIN_USER, "incorrecta123")
        s2, b2, _ = login("usuario_inexistente", "cualquiera")
        self.assertEqual(s2, 401)
        self.assertEqual(b1, b2, "El mensaje revela si el usuario existe")


# ---------- CP-03 ----------
@unittest.skipUnless(DATABASE_URL, "Requiere DATABASE_URL")
class CP03_HashContrasenas(unittest.TestCase):
    """NFR-SEG-2: las contraseñas no deben guardarse en texto plano (bcrypt)."""
    def test_hash_no_es_texto_plano(self):
        h = psql(f"SELECT contrasena_hash FROM usuarios WHERE nombre_usuario='{ADMIN_USER}'")
        self.assertNotEqual(h, ADMIN_PASS)
        self.assertTrue(h.startswith("$2"), f"No parece bcrypt: {h[:10]}...")


# ---------- CP-04 ----------
@unittest.skipUnless(EDITOR_USER and EDITOR_PASS, "Requiere EDITOR_USER y EDITOR_PASS")
class CP04_EditorSinEscritura(unittest.TestCase):
    """RF-3.2, RB-4, NFR-SEG-4: un editor no puede crear clientes (esperado 403)."""
    def test_editor_no_puede_crear_cliente(self):
        _, _, token = login(EDITOR_USER, EDITOR_PASS)
        status, body, _ = call("POST", "/clientes",
                               {"nombre": "Cliente Editor", "correo": "e@prueba.cl",
                                "telefono": "5550000", "direccion": "Calle 1"}, token)
        self.assertEqual(status, 403, body)


# ---------- CP-05 ----------
class CP05_TiempoListado(Base):
    """NFR-PERF-1: GET /clientes < 300 ms (mediana de 10 ejecuciones)."""
    def test_mediana_menor_300ms(self):
        tiempos = []
        for _ in range(10):
            status, _, t = call("GET", "/clientes", token=self.token)
            self.assertEqual(status, 200)
            tiempos.append(t)
        mediana = statistics.median(tiempos)
        self.assertLess(mediana, 0.300, f"Mediana {mediana*1000:.0f} ms")


# ---------- CP-06 ----------
class CP06_EliminarCliente(Base):
    """RF-4.2: eliminar un cliente; luego no debe aparecer en el listado."""
    def test_eliminar_y_no_listar(self):
        s, b, _ = call("POST", "/clientes",
                       {"nombre": "Cliente Eliminar", "correo": "del@prueba.cl",
                        "telefono": "5551111", "direccion": "Calle 2"}, self.token)
        self.assertIn(s, (200, 201), b)
        cid = b.get("id") if isinstance(b, dict) else None
        self.assertIsNotNone(cid, "La respuesta de creación no trae id")
        s, _, _ = call("DELETE", f"/clientes/{cid}", token=self.token)
        self.assertEqual(s, 200)
        s, _, _ = call("GET", f"/clientes/{cid}", token=self.token)
        self.assertEqual(s, 404)


# ---------- CP-09 ----------
class CP09_RegistroEmpresa(Base):
    """RF-2.2, RF-2.3: el primer usuario de una empresa es administrador.
    [verificar] cuerpo exacto de POST /empresas."""
    def test_crear_empresa(self):
        s, b, _ = call("POST", "/empresas",
                       {"nombre": "Empresa Prueba 1", "direccion": "Av. Prueba 123",
                        "telefono": "225550000", "correo": "empresa1@prueba.cl"}, self.token)
        self.assertIn(s, (200, 201), b)


# ---------- CP-10 ----------
class CP10_UsuariosYRoles(Base):
    """RF-3.1, RF-3.3, RB-2: crear, editar y eliminar usuario."""
    def test_usuario_crud(self):
        s, b, _ = call("POST", "/usuarios",
                       {"nombre_usuario": "usuario_prueba_cp10",
                        "contrasena_hash": "clave123", "correo": "cp10@prueba.cl"}, self.token)
        self.assertEqual(s, 201, b)
        uid = b["id"]
        s, _, _ = call("PUT", f"/usuarios/{uid}", {"correo": "cp10b@prueba.cl"}, self.token)
        self.assertEqual(s, 200)
        s, _, _ = call("DELETE", f"/usuarios/{uid}", token=self.token)
        self.assertIn(s, (200, 204))


# ---------- CP-11 ----------
class CP11_ValidacionClientes(Base):
    """RF-4.3: un correo sin formato debe rechazarse con 400."""
    def test_correo_invalido_rechazado(self):
        s, b, _ = call("POST", "/clientes",
                       {"nombre": "Cliente Validación", "correo": "contacto-sin-arroba",
                        "telefono": "12-34-abc", "direccion": "Calle 3"}, self.token)
        self.assertEqual(s, 400, b)


# ---------- CP-12 ----------
@unittest.skip("[verificar] Contratos requiere multipart y reglas de RF-5; diseñar antes de ejecutar")
class CP12_Contratos(unittest.TestCase):
    def test_pendiente(self):
        pass


# ---------- CP-13 ----------
class CP13_CierreSesion(Base):
    """RF-1.2, NFR-SEG-9: tras cerrar sesión el token no debe aceptarse.
    No existe POST /autenticacion/logout en auth.js: el caso falla por diseño del sistema."""
    def test_logout_existe(self):
        s, _, _ = call("POST", "/autenticacion/logout", token=self.token)
        self.assertIn(s, (200, 204))

    def test_token_revocado(self):
        call("POST", "/autenticacion/logout", token=self.token)
        s, _, _ = call("GET", "/clientes", token=self.token)
        self.assertEqual(s, 401)


# ---------- CP-14 ----------
class CP14_TLS(unittest.TestCase):
    """NFR-SEG-1: la API debe servirse por HTTPS. En el ambiente local (HTTP) falla."""
    def test_api_usa_https(self):
        self.assertTrue(API.startswith("https://"), f"API en {API}")


# ---------- CP-15 ----------
class CP15_Inyeccion(Base):
    """NFR-SEG-5: inyección SQL y XSS almacenado en el nombre de cliente."""
    def test_sql_injection_no_altera_consulta(self):
        s, _, _ = call("GET", "/clientes/search?q=" + urllib.parse.quote("' OR '1'='1"), token=self.token)
        self.assertIn(s, (200, 400))
        s2, b2, _ = call("GET", "/clientes", token=self.token)
        self.assertEqual(s2, 200)
        self.assertLess(len(b2 if isinstance(b2, list) else []), 10000)

    def test_xss_se_guarda_escapado(self):
        payload = "<script>alert(1)</script>"
        s, b, _ = call("POST", "/clientes",
                       {"nombre": payload, "correo": "xss@prueba.cl",
                        "telefono": "5552222", "direccion": "Calle 4"}, self.token)
        if s not in (200, 201):
            self.skipTest(f"No se pudo crear el cliente: {s}")
        s, lista, _ = call("GET", "/clientes", token=self.token)
        self.assertNotIn(payload, json.dumps(lista), "XSS almacenado sin escapar")


# CP-16 a CP-20: no son pruebas de API. Se ejecutan con otras herramientas (ver Plan).
@unittest.skip("CP-16: respaldo y restauración con pg_dump/pg_restore (manual)")
class CP16_Respaldo(unittest.TestCase):
    def test_manual(self): pass

@unittest.skip("CP-17: Lighthouse en Chromium (manual)")
class CP17_Lighthouse(unittest.TestCase):
    def test_manual(self): pass

@unittest.skip("CP-18: JMeter, 200 usuarios (manual)")
class CP18_JMeter(unittest.TestCase):
    def test_manual(self): pass

@unittest.skip("CP-19: revisión de usabilidad con evaluador (manual)")
class CP19_Usabilidad(unittest.TestCase):
    def test_manual(self): pass

@unittest.skip("CP-20: inspección de formularios y monitoreo de 30 días (manual)")
class CP20_Normativa(unittest.TestCase):
    def test_manual(self): pass


if __name__ == "__main__":
    unittest.main()
