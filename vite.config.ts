import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  optimizeDeps: { include: ["three/examples/jsm/lines/Line2.js", "three/examples/jsm/lines/LineGeometry.js", "three/examples/jsm/lines/LineMaterial.js"] },
  test: { include: ["src/**/*.test.ts"] },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          three: ["three"],
          react: ["react", "react-dom", "zustand"],
        },
      },
    },
  },
});
