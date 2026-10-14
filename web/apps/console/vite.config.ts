import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

// The MSW worker is only for `vite --mode mock`; never ship it.
function stripMockWorker(): Plugin {
  return {
    name: "hcdn-strip-mock-worker",
    apply: "build",
    async closeBundle() {
      await rm(fileURLToPath(new URL("./dist/mockServiceWorker.js", import.meta.url)), { force: true });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), stripMockWorker()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  server: {
    port: 5174,
    proxy: { "/api": { target: "http://127.0.0.1:18080", changeOrigin: false } },
  },
  build: {
    target: "es2022",
    sourcemap: false,
    chunkSizeWarningLimit: 900,
  },
});
