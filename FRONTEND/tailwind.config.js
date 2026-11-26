/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        primary: "#1B7576",
        secondary: "#237A4B", // DEF-21: 5,3:1 con texto blanco (antes #4BBC7F, 2,4:1)
      },
      fontFamily: {
        sans: ["Poppins", "Arial", "sans-serif"],
      },
      fontSize: {
        base: "16px" /* DEF-21: NFR-USAB-1, texto legible para adultos mayores (antes 13px) */,
      },
    },
  },
  plugins: [],
};
