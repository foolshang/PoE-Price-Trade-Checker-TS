import { defineConfig } from "electron-vite";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = JSON.parse(readFileSync(path.resolve(import.meta.dirname, "../../package.json"), "utf-8"));
const define = { __APP_VERSION__: JSON.stringify(root.version), __BUILD_TIME__: JSON.stringify(new Date().toISOString()) };
const bundleOurPackages = { exclude: ["@poe/core", "@poe/node", "@poe/ui", "@poe/desktop"] };
const src = (p: string): string => path.resolve(import.meta.dirname, "src", p);

export default defineConfig({
  main: {
    define,
    build: {
      externalizeDeps: bundleOurPackages, // (koffi stays external: a native module, shipped next to the app)
      outDir: "out/main",
      lib: { entry: src("main/index.ts"), formats: ["cjs"], fileName: () => "index.cjs" },
    },
  },
  preload: {
    build: {
      externalizeDeps: bundleOurPackages,
      outDir: "out/preload",
      rollupOptions: {
        input: { main: src("preload/main.ts"), picker: src("preload/picker.ts"), skill: src("preload/skill.ts"), settings: src("preload/settings.ts"), overlay: src("preload/overlay.ts"), filter: src("preload/filter.ts") },
        output: { format: "cjs", entryFileNames: "[name].cjs" },
      },
    },
  },
  renderer: {
    root: src("renderer"),
    base: "./",
    publicDir: path.resolve(import.meta.dirname, "../web/public"), // the names snapshot of the filter page is shared with the web page
    define,
    build: {
      outDir: path.resolve(import.meta.dirname, "out/renderer"),
      emptyOutDir: true,
      rollupOptions: { input: { index: src("renderer/index.html"), picker: src("renderer/picker.html"), skillref: src("renderer/skillref.html"), settings: src("renderer/settings.html"), overlay: src("renderer/overlay.html"), filter: src("renderer/filter.html") } },
    },
  },
});
