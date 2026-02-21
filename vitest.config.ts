import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      react: resolve("node_modules/react"),
      "react-dom": resolve("node_modules/react-dom"),
      "react-dom/client": resolve("node_modules/react-dom/client"),
    },
  },
  test: {
    environmentMatchGlobs: [
      ["dashboard/**", "happy-dom"],
    ],
  },
});
