import { defineConfig } from "vite";
import { copyFileSync, createReadStream, existsSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, extname, resolve } from "node:path";
import preact from "@preact/preset-vite";

const require = createRequire(import.meta.url);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)));
const webRoot = resolve(repoRoot, "web");

// Root-served assets the SPA loads by absolute path (workers, sample).
// Vite only auto-copies `public/`; keep these next to index.html for static/dev servers.
const ROOT_STATIC_ASSETS = [
  "deepbump.worker.js",
  "deepbump_infer.js",
  "demo.png",
  "demo_ai_normal.png",
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

// Dev-only: serve the top-level demo/ (three.js normal-map showcase) at /demo/
// so `make web` also serves it. apply:"serve" keeps vite build / Vercel untouched.
function serveDemo() {
  const mounts = {
    "/demo": resolve(repoRoot, "demo"),
    "/node_modules": resolve(repoRoot, "node_modules"),
  };
  const MIME = {
    ".html": "text/html",
    ".js": "text/javascript",
    ".css": "text/css",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".json": "application/json",
    ".wasm": "application/wasm",
  };
  return {
    name: "serve-demo",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url, "http://x").pathname;
        const key = Object.keys(mounts).find((m) => url === m || url.startsWith(m + "/"));
        if (!key) return next();
        let file = resolve(mounts[key], "." + url.slice(key.length));
        if (!file.startsWith(mounts[key])) return next(); // traversal guard
        if (existsSync(file) && statSync(file).isDirectory()) file = resolve(file, "index.html");
        if (!existsSync(file)) return next();
        res.setHeader("Content-Type", MIME[extname(file)] ?? "application/octet-stream");
        createReadStream(file).pipe(res);
      });
    },
  };
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
    serveDemo(),
    copyRootStaticAssets(),
  ],
}));
