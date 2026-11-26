import { createTheme } from "@mui/material";

const theme = createTheme({
  palette: {
    primary: { main: "#1B7576" }, // Verde azulado
    secondary: { main: "#237A4B" }, // DEF-21: verde con contraste 5,3:1 sobre blanco
    background: { default:"#fffff", paper: "#ffffff" }, // slate-50
  },
  typography: {
    fontFamily: "Poppins, system-ui, Avenir, Helvetica, Arial, sans-serif",
    fontSize: 14, // Reducido de 14px (default) a 12px (2pt menos)
    h5: { fontWeight: 700 },
    h6: { fontWeight: 600 },
  },
  shape: { borderRadius: 4 },
  components: {
    MuiButton: {
      styleOverrides: {
        root: { textTransform: "none", borderRadius: 4, boxShadow: "none" },
      },
    },
    MuiAppBar: {
      styleOverrides: {
        root: { boxShadow: "none", borderBottom: "1px solid #e5e7eb" },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: { borderRadius: 4, border: "1px solid #eef2f7" },
      },
    },
  },
});

export default theme;
