import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Permette di importare file fuori da web/ (config/uccellini.json, src/schema.ts).
  server: { fs: { allow: [".."] } },
});
