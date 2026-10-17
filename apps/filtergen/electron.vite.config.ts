import { defineConfig } from "electron-vite";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = JSON.parse(readFileSync(path.resolve(import.meta.dirname, "../../package.json"), "utf-8"));
const define = { __APP_VERSION__: JSON.stringify(root.version), __BUILD_TIME__: JSON.stringify(new Date().toISOString()) };
const bundleOurPackages = { exclude: ["@poe/core", "@poe/node", "@poe/ui"] };

export default defineConfig({
  main: {
    define,
    build: {
      externalizeDeps: bundleOurPackages,
      outDir: "out/main",
      lib: { entry: "src/main/index.ts", formats: ["cjs"], fileName: () => "index.cjs" },
    },
  },
  preload: {
    build: {
      externalizeDeps: bundleOurPackages,
      outDir: "out/preload",
      lib: { entry: "src/preload/index.ts", formats: ["cjs"], fileName: () => "index.cjs" },
    },
  },
  renderer: {
    root: "src/renderer",
    base: "./",
    publicDir: path.resolve(import.meta.dirname, "../web/public"), // the names snapshot is shared with the web page
    define,
    build: { outDir: path.resolve(import.meta.dirname, "out/renderer"), emptyOutDir: true },
  },
});
