#!/usr/bin/env node
/*
 * Run preview cases from tests/golden/manifest.json through the JS core
 * (shared/normal.js + shared/preview.js) and write <id>_preview.png outputs.
 *
 * Mirrors the role of scripts/run_core_cases.py but stays in Node so the
 * golden-test path is JS-only — the self-consistency check reruns this same
 * script and compares bytes, with no Python <-> Node round trip in the
 * comparison itself.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pngjs from "pngjs";
import { generateNormalMap, DEFAULT_NORMAL_PARAMS } from "../shared/normal.js";
import { buildLitPreview, DEFAULT_LIGHT_PARAMS } from "../shared/preview.js";

const { PNG } = pngjs;
const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

function parseArgs(argv) {
  const args = { manifest: "tests/golden/manifest.json", outDir: "tests/golden/node", case: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--manifest") args.manifest = argv[++i];
    else if (a === "--out-dir") args.outDir = argv[++i];
    else if (a === "--case") args.case = argv[++i];
    else throw new Error(`unknown flag: ${a}`);
  }
  return args;
}

function loadManifest(path) {
  return JSON.parse(readFileSync(path, "utf-8"));
}

function loadPng(path) {
  const png = PNG.sync.read(readFileSync(path));
  return { width: png.width, height: png.height, data: png.data };
}

function writePng(path, image) {
  mkdirSync(dirname(path), { recursive: true });
  const png = new PNG({ width: image.width, height: image.height });
  png.data = Buffer.from(image.data);
  writeFileSync(path, PNG.sync.write(png));
}

function runCase(repo, caseObj, outDir) {
  if (caseObj.map !== "preview") return;
  if (caseObj.enabled === false) return;

  const source = loadPng(resolve(repo, caseObj.input));
  const params = { ...DEFAULT_NORMAL_PARAMS, ...(caseObj.params || {}) };
  const normal = generateNormalMap(source, params);
  const light = { ...DEFAULT_LIGHT_PARAMS, ...(caseObj.light || {}) };
  const lit = buildLitPreview(source, normal, light, Boolean(caseObj.toon));

  const outPath = resolve(repo, outDir, `${caseObj.id}_preview.png`);
  writePng(outPath, lit);
  process.stdout.write(`wrote ${outPath}\n`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const manifestPath = resolve(repoRoot, args.manifest);
  const manifest = loadManifest(manifestPath);
  const cases = args.case ? manifest.cases.filter((c) => c.id === args.case) : manifest.cases;
  for (const caseObj of cases) {
    runCase(repoRoot, caseObj, args.outDir);
  }
}

main();
