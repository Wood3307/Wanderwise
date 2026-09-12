import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5188,
    strictPort: true,
    proxy: { "/api": "http://127.0.0.1:3001" },
  },
  preview: { proxy: { "/api": "http://127.0.0.1:3001" } },
  build: { rollupOptions: { output: { manualChunks: { three: ["three"] } } } },
});
