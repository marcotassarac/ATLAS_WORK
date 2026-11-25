import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, abrirDocumentoContrato, API_URL } from "../../lib/api";
import { Button, Card, CardContent, Chip, Stack, Typography } from "@mui/material";
import { useAuth } from "../../hooks/useAuth";
import { toast } from "sonner";

export default function ContratoDetalle() {
  const { id } = useParams();
  const [item, setItem] = useState(null);
  const navigate = useNavigate();
  const { role } = useAuth();

  const load = async () => {
    const { data } = await api.get(`/contratos/${id}`);
    setItem(data);
  };
  useEffect(() => {
    load();
  }, [id]); // eslint-disable-line

  const onDelete = async () => {
    if (role !== "administrador") return;
    await api.delete(`/contratos/${id}`);
    toast.success("Contrato eliminado");
    navigate("/contratos");
  };

  // DEF-15 (RF-5.5): enlace de vigencia limitada para compartir el documento
  const onCompartir = async () => {
    const { data } = await api.post(`/contratos/${id}/enlace`, { minutos: 60 });
    const url = data.url.startsWith("http") ? data.url : `${API_URL}${data.url}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Enlace copiado (válido por 60 minutos)", { description: url });
    } catch {
      toast.success("Enlace generado (válido por 60 minutos)", { description: url, duration: 20000 });
    }
  };

  const ESTADOS = { activo: ["Activo", "success"], vence: ["Vence pronto", "warning"], expirado: ["Expirado", "error"] };

  if (!item) return null;
  return (
    <Card>
      <CardContent>
        <Stack spacing={2}>
          <Typography variant="h6">{item.titulo}</Typography>
          {item.estado && (
            <Chip
              label={ESTADOS[item.estado]?.[0] || item.estado}
              color={ESTADOS[item.estado]?.[1] || "default"}
              sx={{ alignSelf: "flex-start" }}
            />
          )}
          <Typography>Cliente: {item.cliente_id}</Typography>
          <Typography>Inicio: {item.fecha_inicio}</Typography>
          <Typography>Fin: {item.fecha_fin}</Typography>
          {item.descripcion && (
            <Typography>Descripción: {item.descripcion}</Typography>
          )}
          {item.tiene_documento && (
            <Button variant="outlined" onClick={() => abrirDocumentoContrato(id)}>
              Ver archivo
            </Button>
          )}
          {item.tiene_documento && role === "administrador" && (
            <Button variant="outlined" onClick={onCompartir}>
              Compartir enlace (60 minutos)
            </Button>
          )}
          {role === "administrador" && (
            <Button color="error" variant="contained" onClick={onDelete}>
              Eliminar
            </Button>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}
