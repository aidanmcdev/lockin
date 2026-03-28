import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { viteStaticCopy } from "vite-plugin-static-copy";
import { resolve } from "path";

export default defineConfig(({ mode }) => {
  if (mode === "content") {
    return {
      plugins: [react(), tailwindcss()],
      resolve: {
        alias: {
          "@": resolve(__dirname, "./src"),
        },
      },
      build: {
        outDir: "build",
        emptyOutDir: false,
        rollupOptions: {
          input: resolve(__dirname, "src/content.jsx"),
          output: {
            format: "iife",
            entryFileNames: "content.js",
          },
        },
      },
    };
  }

  return {
    plugins: [
      react(),
      tailwindcss(),
      viteStaticCopy({
        targets: [
          { src: "public/manifest.json", dest: "." },
          { src: "public/background.js", dest: "." },
        ],
      }),
    ],
    resolve: {
      alias: {
        "@": resolve(__dirname, "./src"),
      },
    },
    build: {
      outDir: "build",
      rollupOptions: {
        input: { main: "./index.html" },
      },
    },
  };
});
