import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import preact from "@preact/preset-vite";

import treelocator from "@treelocator/vite";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)));

export default defineConfig({
  root: "web",
  resolve: {
    alias: {
      shared: resolve(repoRoot, "shared"),
    },
  },
  // Allow Vite to serve files from the repo root (sample images etc.)
  server: { fs: { allow: [repoRoot] } },
  plugins: [preact({
      babel: {
        plugins: [
          ["@locator/babel-jsx/dist", { env: "development" }],
        ],
      },
    }), treelocator()],
});