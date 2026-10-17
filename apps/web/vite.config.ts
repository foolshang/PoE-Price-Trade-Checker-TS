import { readFileSync } from "node:fs";
import { defineConfig } from "vite";

const version: string = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf-8")).version;

// the hub only allows https://foolshang.github.io as an origin (CORS): for a local test the server forwards /__hub/* to it
const hubProxy = { "/__hub": { target: "https://storage.googleapis.com", changeOrigin: true, rewrite: (p: string) => p.replace(/^\/__hub/, "/poe-data-hub") } };

// base "./": the page works from any folder (GitHub Pages sub-path /ts/ included)
export default defineConfig({
  base: "./",
  define: { __APP_VERSION__: JSON.stringify(version) },
  build: { outDir: "dist", target: "es2022", sourcemap: false },
  server: { port: 5173, strictPort: false, proxy: hubProxy },
  preview: { port: 4173, strictPort: false, proxy: hubProxy },
});
