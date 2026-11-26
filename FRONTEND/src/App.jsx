import { lazy, Suspense } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "sonner";
import { RequireAuth, RequireAdmin, RequireAdminOPropio } from "./components/RoleGuard";
import Login from "./pages/auth/Login";

// DEF-22 (NFR-PERF-2): cada pantalla se descarga cuando se visita; el login carga
// solo su propio código en lugar de todo el sistema.
const UsuariosList = lazy(() => import("./pages/usuarios/UsuariosList"));
const UsuarioForm = lazy(() => import("./pages/usuarios/UsuarioForm"));
const EmpresaForm = lazy(() => import("./pages/empresas/EmpresaForm"));
const Register = lazy(() => import("./pages/auth/Register"));
const ClientesList = lazy(() => import("./pages/clientes/ClientesList"));
const ClienteForm = lazy(() => import("./pages/clientes/ClienteForm"));
const ContratosList = lazy(() => import("./pages/contratos/ContratosList"));
const ContratoForm = lazy(() => import("./pages/contratos/ContratoForm"));
const ContratoDetalle = lazy(() => import("./pages/contratos/ContratoDetalle"));
const AuditoriaList = lazy(() => import("./pages/auditoria/AuditoriaList"));
const Home = lazy(() => import("./pages/Home"));
const Privacidad = lazy(() => import("./pages/legal/Privacidad"));

const Layout = lazy(() => import("./components/Layout"));

export default function App() {
  return (
    <>
      <Toaster 
        position="top-center" 
        richColors 
        closeButton 
      />
      <Suspense fallback={<div role="status" style={{ padding: 24 }}>Cargando…</div>}>
      <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/registro" element={<Register />} />
      <Route path="/privacidad" element={<Privacidad />} />
      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route index element={<Home />} />
        <Route path="/home" element={<Home />} />
        <Route path="/clientes" element={<ClientesList />} />
        <Route path="/clientes/nuevo" element={<RequireAdmin><ClienteForm /></RequireAdmin>} />
        <Route path="/clientes/:id/editar" element={<RequireAdmin><ClienteForm /></RequireAdmin>} />
        <Route path="/contratos" element={<ContratosList />} />
        <Route path="/contratos/nuevo" element={<RequireAdmin><ContratoForm /></RequireAdmin>} />
        <Route path="/contratos/:id/editar" element={<RequireAdmin><ContratoForm /></RequireAdmin>} />
        <Route path="/contratos/:id" element={<ContratoDetalle />} />
        <Route path="/empresas/:id/editar" element={<RequireAdmin><EmpresaForm /></RequireAdmin>} />
        <Route path="/auditoria" element={<RequireAdmin><AuditoriaList /></RequireAdmin>} />
        <Route
          path="/usuarios"
          element={
            <RequireAdmin>
              <UsuariosList />
            </RequireAdmin>
          }
        />
        <Route
          path="/usuarios/:id/editar"
          element={
            <RequireAdminOPropio>
              <UsuarioForm />
            </RequireAdminOPropio>
          }
        />
      </Route>
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
      </Suspense>
    </>
  );
}
