import { defineConfig } from "vite";
import preact from "@preact/preset-vite";

import treelocator from "@treelocator/vite";
export default defineConfig({
  root: "web",
  plugins: [preact({
      babel: {
        plugins: [
          ["@locator/babel-jsx/dist", { env: "development" }],
        ],
      },
    }), treelocator()],
});
