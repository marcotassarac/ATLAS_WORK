// DEF-13 (NFR-SEG-8): política de privacidad publicada y enlazada desde el registro.
// Texto de referencia del proyecto académico; no constituye asesoría legal.
import { Link } from "react-router-dom";

const Seccion = ({ titulo, children }) => (
  <section className="mb-6">
    <h2 className="text-xl font-bold text-primary mb-2">{titulo}</h2>
    <div className="text-base leading-relaxed text-gray-800 space-y-2">{children}</div>
  </section>
);

export default function Privacidad() {
  return (
    <main className="min-h-screen bg-white px-6 py-10">
      <article className="max-w-3xl mx-auto">
        <h1 className="text-3xl font-bold text-primary mb-2">Política de privacidad de Atlas</h1>
        <p className="text-sm text-gray-600 mb-8">Versión 1.0 · noviembre de 2026</p>

        <Seccion titulo="1. Quién trata sus datos">
          <p>
            Atlas es una plataforma de gestión de clientes y contratos para pequeñas y medianas empresas. Cada empresa
            registrada es responsable de los datos de sus clientes que ingresa en la plataforma; Atlas los trata por
            encargo de ella y solo para prestar el servicio.
          </p>
        </Seccion>

        <Seccion titulo="2. Qué datos tratamos y para qué">
          <ul className="list-disc pl-6">
            <li>Datos de la cuenta (nombre de usuario y correo): para identificarle e iniciar sesión.</li>
            <li>Datos de la empresa (nombre, dirección, teléfono y correo): para administrar su cuenta.</li>
            <li>Datos de los clientes y contratos que su empresa registre, incluidos datos de contacto, RUT y datos bancarios: para gestionar la relación comercial.</li>
            <li>Registro de actividad (inicio de sesión y acciones sobre los datos): para la seguridad y la trazabilidad exigidas por la ley.</li>
          </ul>
          <p>No vendemos ni cedemos los datos a terceros, ni los usamos con fines publicitarios.</p>
        </Seccion>

        <Seccion titulo="3. Base legal">
          <p>
            El tratamiento se basa en su consentimiento, que entrega al crear la cuenta, y en la ejecución del servicio
            contratado, conforme a la Ley N.° 19.628 sobre protección de la vida privada y a la Ley N.° 21.719, que regula
            la protección y el tratamiento de los datos personales.
          </p>
        </Seccion>

        <Seccion titulo="4. Cómo protegemos los datos">
          <ul className="list-disc pl-6">
            <li>Las comunicaciones viajan cifradas (HTTPS con TLS 1.2 o superior).</li>
            <li>Las contraseñas se guardan con un algoritmo de hash (bcrypt) y nunca en texto legible.</li>
            <li>Los datos bancarios se guardan cifrados.</li>
            <li>Cada empresa accede solo a sus datos, y cada usuario solo a lo que permite su rol.</li>
            <li>Las acciones sobre los datos quedan registradas en una auditoría que no se puede modificar desde la aplicación.</li>
          </ul>
        </Seccion>

        <Seccion titulo="5. Cuánto tiempo conservamos los datos">
          <p>
            Mientras la cuenta esté activa. Los clientes eliminados se conservan marcados como eliminados para mantener el
            historial de contratos y la auditoría, y se suprimen cuando la empresa lo solicita o cuando ya no son
            necesarios para cumplir obligaciones legales.
          </p>
        </Seccion>

        <Seccion titulo="6. Sus derechos">
          <p>
            Puede solicitar el acceso, la rectificación, la supresión, la oposición, la portabilidad y el bloqueo de sus
            datos escribiendo a <strong>privacidad@atlasfake.com</strong>. Responderemos dentro de los plazos que fija la
            ley. También puede retirar su consentimiento en cualquier momento, sin efecto retroactivo.
          </p>
        </Seccion>

        <Link to="/registro" className="inline-block mt-4 text-primary font-semibold underline">
          Volver al registro
        </Link>
      </article>
    </main>
  );
}
