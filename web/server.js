#!/usr/bin/env node

import { createReadStream, promises as fs } from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const webRoot = __dirname;
const port = Number(process.env.PORT || process.env.WEB_PORT || 8765);

const contentTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".jsx", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".svg", "image/svg+xml"],
  [".onnx", "application/octet-stream"],
]);

function sendJson(res, status, body) {
  const data = Buffer.from(JSON.stringify(body, null, 2));
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": data.length,
  });
  res.end(data);
}

function staticPath(urlPath) {
  let pathname = decodeURIComponent(urlPath === "/" ? "/index.html" : urlPath);
  if (pathname === "/web" || pathname === "/web/") {
    pathname = "/index.html";
  } else if (pathname.startsWith("/web/")) {
    pathname = pathname.slice(4);
  }

  const staticRoot = pathname.startsWith("/laigter/") || pathname.startsWith("/shared/") ? repoRoot : webRoot;
  const resolved = path.resolve(staticRoot, `.${pathname}`);
  if (!resolved.startsWith(staticRoot)) {
    return null;
  }
  return resolved;
}

async function handleStatic(req, res, url) {
  const filePath = staticPath(url.pathname);
  if (!filePath) {
    sendJson(res, 403, { ok: false, output: "Forbidden." });
    return;
  }

  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) {
      sendJson(res, 404, { ok: false, output: "Not found." });
      return;
    }
    res.writeHead(200, {
      "content-type": contentTypes.get(path.extname(filePath)) || "application/octet-stream",
      "content-length": stat.size,
    });
    createReadStream(filePath).pipe(res);
  } catch {
    sendJson(res, 404, { ok: false, output: "Not found." });
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (req.method === "GET" || req.method === "HEAD") {
      await handleStatic(req, res, url);
      return;
    }
    sendJson(res, 405, { ok: false, output: "Method not allowed." });
  } catch (error) {
    sendJson(res, 500, { ok: false, output: error.message });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Normalizer web server: http://localhost:${port}/`);
});
