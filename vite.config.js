import { defineConfig } from "vite";
import preact from "@preact/preset-vite";

import treelocator from "@treelocator/vite";
export default defineConfig({
  root: "web",
  // Allow Vite to serve ../laigter/images/* (sample.png, laigter_texture.png)
  // — the browser fetches them as <img src="../laigter/..."> which falls
  // outside Vite's `root` ("web/"). The custom Node server has a staticPath
  // rule for /laigter/; Vite needs server.fs.allow to do the equivalent.
  server: { fs: { allow: [".."] } },
  plugins: [preact({
      babel: {
        plugins: [
          ["@locator/babel-jsx/dist", { env: "development" }],
        ],
      },
    }), treelocator()],
});
