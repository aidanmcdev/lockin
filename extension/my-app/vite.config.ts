import { defineConfig } from "vite";
import type { UserConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { viteStaticCopy } from "vite-plugin-static-copy";
import { resolve } from "path";

export default defineConfig(({ mode, command }) => {
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
        // Second build step; must not wipe the main extension bundle.
        emptyOutDir: false,
        rollupOptions: {
          input: resolve(__dirname, "src/content.jsx"),
          output: {
            format: "iife",
            entryFileNames: "content.js",
          },
        },
      },
    } as UserConfig;
  }

  return {
    // Dev server expects absolute "/src/..." URLs; extension build needs relative assets.
    base: command === "build" ? "./" : "/",
    server: {
      proxy: {
        // ElevenLabs TTS — run `pnpm server` (see package.json) on port 3000
        "/tts": { target: "http://localhost:3000", changeOrigin: true },
      },
    },
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
      emptyOutDir: false,
      rollupOptions: {
        input: {
          main: resolve(__dirname, "index.html"),
          contentFrame: resolve(__dirname, "content-frame.html"),
        },
      },
    },
  } as UserConfig;
});
