import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/*
 * /api is proxied to the Express server so the browser sees one origin in dev.
 * That keeps the session cookie a plain first-party cookie — no CORS credential
 * dance, and the same relative URLs work unchanged in production.
 */
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: process.env.API_URL || "http://127.0.0.1:4000",
        changeOrigin: true,
      },
    },
  },
  build: { outDir: "dist", sourcemap: false },
});
