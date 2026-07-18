import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/@tiptap") || id.includes("node_modules/prosemirror")) {
            return "editor";
          }
          if (id.includes("node_modules/react") || id.includes("node_modules/scheduler")) {
            return "react";
          }
        }
      }
    }
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8080",
        changeOrigin: true,
        ws: true
      },
      "/healthz": "http://127.0.0.1:8080"
    }
  }
});
