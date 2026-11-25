import { useEffect, useMemo, useState } from "react";
import { api, setAuthToken } from "../lib/api";
import { AuthContext } from "./authContextInstance";
import { jwtDecode } from "jwt-decode";

// DEF-05: el rol se obtiene del token emitido por el servidor. Antes se leía de
// localStorage con valor por defecto "administrador", por lo que cualquier
// usuario veía las opciones de administración. Si no hay rol, se asume el de
// menor privilegio (editor). El servidor valida el rol en cada operación.
function rolDesdeToken(token) {
  try {
    return jwtDecode(token).rol || "editor";
  } catch {
    return "editor";
  }
}

export default function AuthProvider({ children }) {
  const [token, setToken] = useState(
    () => localStorage.getItem("token") || null
  );
  const [user, setUser] = useState(() => {
    const u = localStorage.getItem("user");
    return u ? JSON.parse(u) : null;
  });
  const [role, setRole] = useState(() => {
    const t = localStorage.getItem("token");
    return t ? rolDesdeToken(t) : null;
  });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setAuthToken(token);
  }, [token]);

  const login = async ({ nombre_usuario, password }) => {
    setLoading(true);
    try {
      const { data } = await api.post("/autenticacion/login", {
        nombre_usuario,
        password,
      });
      const newToken = data?.token;
      setToken(newToken);
      localStorage.setItem("token", newToken);
      setAuthToken(newToken);
      
      // Decodificar el token JWT usando jwt-decode
      let decodedToken = null;
      try {
        decodedToken = jwtDecode(newToken);
      } catch (error) {
        console.error('Error al decodificar JWT:', error);
      }
      
      // Crear objeto user con nombre_usuario y todo el contenido descifrado del token
      const userData = {
        nombre_usuario,
        ...(decodedToken || {})
      };
      
      setUser(userData);
      localStorage.setItem("user", JSON.stringify(userData));
      setRole(rolDesdeToken(newToken));
      localStorage.removeItem("role");
    } finally {
      setLoading(false);
    }
  };

  const logout = () => {
    setToken(null);
    setUser(null);
    setRole(null);
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    localStorage.removeItem("role");
  };

  const value = useMemo(
    () => ({ token, user, role, loading, login, logout }),
    [token, user, role, loading]
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
