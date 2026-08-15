import path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: { outDir: "dist", emptyOutDir: true },
  resolve: { alias: { "@": path.resolve(__dirname, "./src/client") } },
  server: {
    proxy: {
      "/api": { target: "http://localhost:8790", changeOrigin: true },
      "/view": { target: "http://localhost:8790", changeOrigin: true },
    },
  },
});
