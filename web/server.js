#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createReadStream, promises as fs } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { URL, fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const webRoot = __dirname;
const normalcyProject = path.join(repoRoot, "third_party", "normalcy");
const port = Number(process.env.PORT || process.env.WEB_PORT || 8765);

const contentTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".svg", "image/svg+xml"],
]);

function sendJson(res, status, body) {
  const data = Buffer.from(JSON.stringify(body, null, 2));
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": data.length,
  });
  res.end(data);
}

function collectRequest(req, limit = 50 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("Request body is too large."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function runUv(args, uvPath, req) {
  return new Promise((resolve) => {
    let settled = false;
    const child = spawn(uvPath || "uv", args, {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (req) {
      req.on("aborted", () => {
        if (!settled && !child.killed) {
          child.kill();
        }
      });
    }
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.on("error", (error) => {
      settled = true;
      resolve({ ok: false, output: error.message, code: -1 });
    });
    child.on("close", (code) => {
      settled = true;
      resolve({ ok: code === 0, output, code });
    });
  });
}

function normalcyBaseArgs(extraArgs = []) {
  return [
    "run",
    "--project",
    normalcyProject,
    "--extra",
    "ai",
    "normalcy",
    ...extraArgs,
  ];
}

async function handleDoctor(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const uvPath = url.searchParams.get("uvPath") || process.env.UV_PATH || "uv";
  const result = await runUv(normalcyBaseArgs(["doctor"]), uvPath, req);
  sendJson(res, result.ok ? 200 : 500, result);
}

async function handleGenerate(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const uvPath = url.searchParams.get("uvPath") || process.env.UV_PATH || "uv";
  const device = url.searchParams.get("device") || "auto";
  const modelSize = url.searchParams.get("modelSize") || "vits";
  const volume = url.searchParams.get("volume") || "1.0";
  const extrude = url.searchParams.get("extrude") || "4";
  const grid = url.searchParams.get("grid") || "";
  const body = await collectRequest(req);

  if (!body.length) {
    sendJson(res, 400, { ok: false, output: "No image body was provided." });
    return;
  }

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "normalizer-normalcy-"));
  try {
    const sourcePath = path.join(tmp, "source.png");
    const normalPath = path.join(tmp, "source_n.png");
    await fs.writeFile(sourcePath, body);

    const buildGenerateArgs = (targetDevice) => {
      const args = normalcyBaseArgs([
        "generate",
        sourcePath,
        "--out",
        tmp,
        "--profile",
        "ai",
        "--engine",
        "gl",
        "--device",
        targetDevice,
        "--model-size",
        modelSize,
        "--volume",
        volume,
        "--extrude",
        extrude,
      ]);
      if (grid) {
        args.push("--grid", grid);
      }
      return args;
    };

    let result = await runUv(buildGenerateArgs(device), uvPath, req);
    if (!result.ok && (device === "auto" || device === "coreml")) {
      const firstOutput = result.output;
      result = await runUv(buildGenerateArgs("cpu"), uvPath, req);
      result.output = `${firstOutput}\n\nRetried with device=cpu.\n${result.output}`;
      result.retriedWithCpu = true;
    }
    if (!result.ok) {
      sendJson(res, 500, result);
      return;
    }

    const normal = await fs.readFile(normalPath);
    res.writeHead(200, {
      "content-type": "image/png",
      "content-length": normal.length,
      "x-normalcy-device": result.retriedWithCpu ? "cpu" : device,
    });
    res.end(normal);
  } catch (error) {
    sendJson(res, 500, { ok: false, output: error.message });
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
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
    if (req.method === "GET" && url.pathname === "/api/normalcy/doctor") {
      await handleDoctor(req, res);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/normalcy/generate") {
      await handleGenerate(req, res);
      return;
    }
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
