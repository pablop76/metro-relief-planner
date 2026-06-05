import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

// PWA (service worker) wyłączone na czas developmentu — powodowało serwowanie
// starego kodu z cache. Włączymy ponownie w fazie 2 (instalacja na telefonie + push).
export default defineConfig({
  define: {
    __BUILD_TIME__: JSON.stringify(new Date().toLocaleString("pl-PL", { hour12: false })),
  },
  server: {
    headers: { "Cache-Control": "no-store" }, // dev: nigdy nie cache'uj
  },
  plugins: [react()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
});
