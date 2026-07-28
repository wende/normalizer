import { defineConfig } from "vite";
import { copyFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import preact from "@preact/preset-vite";

const require = createRequire(import.meta.url);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)));
const webRoot = resolve(repoRoot, "web");

// Root-served assets the SPA loads by absolute path (workers, sample, light sprite).
// Vite only auto-copies `public/`; keep these next to index.html for static/dev servers.
const ROOT_STATIC_ASSETS = [
  "deepbump.worker.js",
  "deepbump_infer.js",
  "demo.png",
  "demo_ai_normal.png",
  "laigter_texture.png",
];

function copyRootStaticAssets() {
  return {
    name: "copy-root-static-assets",
    writeBundle(options) {
      const outDir = options.dir ?? resolve(webRoot, "dist");
      for (const name of ROOT_STATIC_ASSETS) {
        const src = resolve(webRoot, name);
        if (!existsSync(src)) {
          throw new Error(`Missing static asset for deploy: web/${name}`);
        }
        copyFileSync(src, resolve(outDir, name));
      }
    },
  };
}

function optionalDevPlugins(command) {
  if (command !== "serve") return [];

  const plugins = [];
  try {
    const treelocator = require("@treelocator/vite").default;
    plugins.push(treelocator());
  } catch {
    // Local-only; absent on Vercel / clean CI installs.
  }
  return plugins;
}

function preactBabelPlugins(command) {
  if (command !== "serve") return [];
  try {
    require.resolve("@locator/babel-jsx/dist");
    return [["@locator/babel-jsx/dist", { env: "development" }]];
  } catch {
    return [];
  }
}

export default defineConfig(({ command }) => ({
  root: "web",
  resolve: {
    alias: {
      shared: resolve(repoRoot, "shared"),
    },
  },
  server: { fs: { allow: [repoRoot] } },
  plugins: [
    preact({
      babel: {
        plugins: preactBabelPlugins(command),
      },
    }),
    ...optionalDevPlugins(command),
    copyRootStaticAssets(),
  ],
}));
