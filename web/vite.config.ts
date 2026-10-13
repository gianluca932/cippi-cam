import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Permette di importare file fuori da web/ (config/uccellini.json, src/schema.ts).
  server: {
    fs: { allow: [".."] },
    // In sviluppo le chiamate /api vanno al backend (npm run server nella radice).
    proxy: { "/api": "http://localhost:3001" },
  },
});
