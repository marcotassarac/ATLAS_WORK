import { Navigate, useLocation, useParams } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'

export function RequireAuth({ children }) {
  const { token } = useAuth()
  const location = useLocation()
  if (!token) return <Navigate to="/login" state={{ from: location }} replace />
  return children
}

export function RequireAdmin({ children }) {
  const { role } = useAuth()
  if (role !== 'administrador') return <div>No autorizado (solo administrador).</div>
  return children
}



// DEF-15: el administrador edita a cualquier usuario de su empresa; cada usuario puede
// editar su propia cuenta (correo y contraseña). El servidor aplica la misma regla.
export function RequireAdminOPropio({ children }) {
  const { role, user } = useAuth()
  const { id } = useParams()
  if (role === 'administrador' || String(user?.usuarioId) === String(id)) return children
  return <div>No autorizado.</div>
}
