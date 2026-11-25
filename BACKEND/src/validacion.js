// DEF-09: validación de entradas en el servidor (RF-4.3, NFR-SEG-5; OWASP A03:2021, ASVS V5).
// Cada validador devuelve { datos, errores }:
//   datos   -> valores normalizados (texto recortado, "" convertido en null)
//   errores -> { campo: mensaje } con un mensaje comprensible para el usuario
// La interfaz de React ya escapa el contenido al mostrarlo; además se rechazan los
// caracteres < y > en campos de texto para que ningún marcado HTML llegue a la base
// (defensa en profundidad frente a XSS almacenado en otros clientes de la API).

const RE_CORREO = /^[^\s@<>"']+@[^\s@<>"']+\.[A-Za-z]{2,}$/;
const RE_TELEFONO = /^\+?[0-9 ()-]{8,20}$/;
const RE_USUARIO = /^[A-Za-z0-9._-]{3,40}$/;
const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const RE_URL = /^https?:\/\/[^\s<>"']+$/i;

function vacio(v) {
  return v === undefined || v === null || (typeof v === "string" && v.trim() === "");
}

function rutValido(rut) {
  const limpio = String(rut).replace(/[.\s]/g, "").toUpperCase();
  const m = limpio.match(/^(\d{7,8})-?([\dK])$/);
  if (!m) return false;
  let suma = 0;
  let factor = 2;
  for (let i = m[1].length - 1; i >= 0; i--) {
    suma += Number(m[1][i]) * factor;
    factor = factor === 7 ? 2 : factor + 1;
  }
  const resto = 11 - (suma % 11);
  const dv = resto === 11 ? "0" : resto === 10 ? "K" : String(resto);
  return dv === m[2];
}

class Validador {
  constructor(entrada) {
    this.entrada = entrada || {};
    this.datos = {};
    this.errores = {};
  }

  texto(campo, { requerido = false, max = 200, min = 1 } = {}) {
    const v = this.entrada[campo];
    if (vacio(v)) {
      if (requerido) this.errores[campo] = "es obligatorio";
      this.datos[campo] = null;
      return this;
    }
    if (typeof v !== "string" && typeof v !== "number") {
      this.errores[campo] = "debe ser texto";
      return this;
    }
    const t = String(v).trim();
    if (t.length < min) this.errores[campo] = `debe tener al menos ${min} caracteres`;
    else if (t.length > max) this.errores[campo] = `admite como máximo ${max} caracteres`;
    else if (/[<>]/.test(t)) this.errores[campo] = "no puede contener los caracteres < o >";
    this.datos[campo] = t;
    return this;
  }

  correo(campo, { requerido = false } = {}) {
    this.texto(campo, { requerido, max: 254 });
    const v = this.datos[campo];
    if (v && !this.errores[campo] && !RE_CORREO.test(v)) this.errores[campo] = "no tiene un formato de correo válido";
    if (v) this.datos[campo] = v.toLowerCase();
    return this;
  }

  telefono(campo, { requerido = false } = {}) {
    this.texto(campo, { requerido, max: 20 });
    const v = this.datos[campo];
    if (v && !this.errores[campo]) {
      const digitos = v.replace(/\D/g, "").length;
      if (!RE_TELEFONO.test(v) || digitos < 8 || digitos > 15) this.errores[campo] = "no tiene un formato de teléfono válido";
    }
    return this;
  }

  rut(campo) {
    this.texto(campo, { max: 12 });
    const v = this.datos[campo];
    if (v && !this.errores[campo] && !rutValido(v)) this.errores[campo] = "no es un RUT válido (revise el dígito verificador)";
    return this;
  }

  url(campo) {
    this.texto(campo, { max: 300 });
    const v = this.datos[campo];
    if (v && !this.errores[campo] && !RE_URL.test(v)) this.errores[campo] = "debe comenzar con http:// o https://";
    return this;
  }

  opcion(campo, opciones) {
    const v = this.entrada[campo];
    if (vacio(v)) { this.datos[campo] = null; return this; }
    if (!opciones.includes(String(v))) this.errores[campo] = `debe ser uno de: ${opciones.join(", ")}`;
    this.datos[campo] = String(v);
    return this;
  }

  entero(campo, { requerido = false, min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
    const v = this.entrada[campo];
    if (vacio(v)) {
      if (requerido) this.errores[campo] = "es obligatorio";
      this.datos[campo] = null;
      return this;
    }
    const n = Number(v);
    if (!Number.isInteger(n) || n < min || n > max) this.errores[campo] = `debe ser un número entero entre ${min} y ${max}`;
    this.datos[campo] = n;
    return this;
  }

  fecha(campo, { requerido = false } = {}) {
    const v = this.entrada[campo];
    if (vacio(v)) {
      if (requerido) this.errores[campo] = "es obligatoria";
      this.datos[campo] = null;
      return this;
    }
    const t = String(v).slice(0, 10);
    const d = new Date(`${t}T00:00:00Z`);
    if (!RE_FECHA.test(t) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== t) {
      this.errores[campo] = "debe ser una fecha válida (AAAA-MM-DD)";
    }
    this.datos[campo] = t;
    return this;
  }

  booleano(campo) {
    const v = this.entrada[campo];
    this.datos[campo] = v === true || v === "true" || v === 1 || v === "1";
    return this;
  }

  usuario(campo) {
    this.texto(campo, { requerido: true, max: 40 });
    const v = this.datos[campo];
    if (v && !this.errores[campo] && !RE_USUARIO.test(v)) {
      this.errores[campo] = "solo admite letras, números, punto, guion y guion bajo (3 a 40 caracteres)";
    }
    return this;
  }

  resultado() {
    return { datos: this.datos, errores: this.errores };
  }
}

function validarCliente(b) {
  return new Validador(b)
    .texto("nombre", { requerido: true, max: 120, min: 2 })
    .correo("correo", { requerido: true })
    .telefono("telefono")
    .texto("direccion")
    .booleano("es_empresa")
    .rut("rut")
    .texto("nombre_fantasia")
    .texto("giro_actividad_economica")
    .texto("nombre_representante", { max: 120 })
    .texto("cargo_representante", { max: 120 })
    .correo("correo_representante")
    .telefono("telefono_representante")
    .texto("relacion_representante", { max: 120 })
    .texto("direccion_calle")
    .texto("direccion_numero", { max: 20 })
    .texto("direccion_ciudad", { max: 120 })
    .texto("direccion_region", { max: 120 })
    .url("sitio_web")
    .telefono("telefono_corporativo")
    .opcion("metodo_pago", ["transferencia", "cheque", "efectivo", "tarjeta", "otro"])
    .entero("dia_pago", { min: 1, max: 31 })
    .texto("moneda", { max: 10 })
    .texto("nombre_banco", { max: 120 })
    .texto("numero_cuenta", { max: 40 })
    .texto("titular_cuenta", { max: 120 })
    .resultado();
}

function validarContrato(b, { parcial = false } = {}) {
  const v = new Validador(b);
  const req = !parcial;
  if (!parcial || b.cliente_id !== undefined) v.entero("cliente_id", { requerido: true });
  if (!parcial || b.titulo !== undefined) v.texto("titulo", { requerido: true, max: 150, min: 2 });
  if (!parcial || b.descripcion !== undefined) v.texto("descripcion", { max: 2000 });
  if (!parcial || b.fecha_inicio !== undefined) v.fecha("fecha_inicio", { requerido: req });
  if (!parcial || b.fecha_fin !== undefined) v.fecha("fecha_fin", { requerido: req });
  const { datos, errores } = v.resultado();
  if (datos.fecha_inicio && datos.fecha_fin && !errores.fecha_inicio && !errores.fecha_fin && datos.fecha_fin < datos.fecha_inicio) {
    errores.fecha_fin = "no puede ser anterior a la fecha de inicio";
  }
  return { datos, errores };
}

function validarEmpresa(b) {
  return new Validador(b)
    .texto("nombre", { requerido: true, max: 120, min: 2 })
    .texto("direccion")
    .telefono("telefono")
    .correo("correo", { requerido: true })
    .resultado();
}

function validarUsuarioNuevo(b) {
  return new Validador(b).usuario("nombre_usuario").correo("correo", { requerido: true }).resultado();
}

function hayErrores(errores) {
  return Object.keys(errores).length > 0;
}

// Respuesta 400 uniforme que indica cada campo afectado (RF-4.3)
function responderErrores(res, errores) {
  const detalle = Object.entries(errores).map(([c, m]) => `${c} ${m}`).join("; ");
  return res.status(400).json({ error: "Datos inválidos", glosa: `Revise los campos: ${detalle}.`, campos: errores });
}

module.exports = {
  Validador, rutValido, validarCliente, validarContrato, validarEmpresa, validarUsuarioNuevo,
  hayErrores, responderErrores,
};
