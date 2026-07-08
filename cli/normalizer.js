#!/usr/bin/env node
/*
 * normalizer CLI — normal- and specular-map generation.
 *
 * Derived from Laigter's GPL-3.0 logic; mirrors the argument/exit contract of
 * core/tools/laigter_core_cli.cpp so scripts/run_core_cases.py can drive either
 * binary via its --cli flag. Reads an 8-bit PNG, writes an 8-bit RGBA map.
 */

import { readFileSync, writeFileSync } from "node:fs";
import pngjs from "pngjs";
import { generateNormalMap, DEFAULT_NORMAL_PARAMS } from "../shared/normal.js";
import { generateSpecularMap, DEFAULT_SPECULAR_PARAMS } from "../shared/specular.js";

const { PNG } = pngjs;

const USAGE = [
  "usage: normalizer <command> <input.png> <output.png> [options]",
  "",
  "commands:",
  "  normal                           generate a tangent-space normal map",
  "  specular                         generate a specular reflectivity map",
  "",
  "normal options:",
  "  --normal-depth <int>             emboss strength (default 250)",
  "  --normal-blur-radius <int>       emboss pre-blur radius (default 6)",
  "  --normal-bisel-depth <int>       bevel strength (default 100)",
  "  --normal-bisel-distance <int>    bevel width (default 60)",
  "  --normal-bisel-blur-radius <int> bevel smoothing (default 10)",
  "  --hard-bisel                     disable the soft (circular) bevel profile",
  "  --invert-x                       flip the X channel",
  "  --invert-y                       flip the Y channel",
  "  --invert-z                       flip the Z channel",
  "  --use-normal-alpha               copy the source alpha into the output",
  "",
  "specular options:",
  "  --specular-thresh <int>          contrast pivot (default 127)",
  "  --specular-contrast <float>      contrast (default 1.0)",
  "  --specular-bright <int>          brightness offset (default 0)",
  "  --specular-blur <int>            blur sigma (default 3)",
  "  --specular-invert                invert the map",
  "  --use-specular-alpha             copy the source alpha into the output",
].join("\n");

function failUsage(message) {
  process.stderr.write(`error: ${message}\n\n${USAGE}\n`);
  process.exit(2);
}

function fail(message) {
  process.stderr.write(`error: ${message}\n\n${USAGE}\n`);
  process.exit(1);
}

function requireValue(args, i, flag) {
  if (i >= args.length) {
    fail(`${flag} expects a value`);
  }
  return args[i];
}

// strtol(base 10) semantics: optional sign + digits, leading/trailing whitespace
// tolerated, fully consumed otherwise.
function parseInt32(value, flag) {
  const trimmed = value.trim();
  if (!/^[+-]?\d+$/.test(trimmed)) {
    fail(`${flag} expects an integer`);
  }
  return Number.parseInt(trimmed, 10);
}

function parseFloatNumber(value, flag) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    fail(`${flag} expects a number`);
  }
  return n;
}

function parseNormalFlags(args) {
  const params = { ...DEFAULT_NORMAL_PARAMS };
  for (let i = 3; i < args.length; i += 1) {
    const arg = args[i];
    switch (arg) {
      case "--normal-depth":
        params.normalDepth = parseInt32(requireValue(args, (i += 1), arg), arg);
        break;
      case "--normal-blur-radius":
        params.normalBlurRadius = parseInt32(requireValue(args, (i += 1), arg), arg);
        break;
      case "--normal-bisel-depth":
        params.biselDepth = parseInt32(requireValue(args, (i += 1), arg), arg);
        break;
      case "--normal-bisel-distance":
        params.biselDistance = parseInt32(requireValue(args, (i += 1), arg), arg);
        break;
      case "--normal-bisel-blur-radius":
        params.biselBlurRadius = parseInt32(requireValue(args, (i += 1), arg), arg);
        break;
      case "--hard-bisel":
        params.softBisel = false;
        break;
      case "--invert-x":
        params.invertX = true;
        break;
      case "--invert-y":
        params.invertY = true;
        break;
      case "--invert-z":
        params.invertZ = true;
        break;
      case "--use-normal-alpha":
        params.useAlpha = true;
        break;
      default:
        fail(`unknown option: ${arg}`);
    }
  }
  return params;
}

function parseSpecularFlags(args) {
  const params = { ...DEFAULT_SPECULAR_PARAMS };
  for (let i = 3; i < args.length; i += 1) {
    const arg = args[i];
    switch (arg) {
      case "--specular-thresh":
        params.specularThresh = parseInt32(requireValue(args, (i += 1), arg), arg);
        break;
      case "--specular-contrast":
        params.specularContrast = parseFloatNumber(requireValue(args, (i += 1), arg), arg);
        break;
      case "--specular-bright":
        params.specularBright = parseInt32(requireValue(args, (i += 1), arg), arg);
        break;
      case "--specular-blur":
        params.specularBlur = parseInt32(requireValue(args, (i += 1), arg), arg);
        break;
      case "--specular-invert":
        params.specularInvert = true;
        break;
      case "--use-specular-alpha":
        params.useAlpha = true;
        break;
      default:
        fail(`unknown option: ${arg}`);
    }
  }
  return params;
}

function parseArgs(args) {
  if (args.length === 0) {
    process.stdout.write(`${USAGE}\n`);
    process.exit(2);
  }
  if (args[0] === "-h" || args[0] === "--help") {
    process.stdout.write(`${USAGE}\n`);
    process.exit(0);
  }
  const command = args[0];
  if (command !== "normal" && command !== "specular") {
    fail(`unknown command: ${command}`);
  }
  if (args.length < 3) {
    failUsage("missing input/output arguments");
  }

  const params = command === "normal" ? parseNormalFlags(args) : parseSpecularFlags(args);
  return { command, inputPath: args[1], outputPath: args[2], params };
}

const { command, inputPath, outputPath, params } = parseArgs(process.argv.slice(2));

let inputPng;
try {
  inputPng = PNG.sync.read(readFileSync(inputPath));
} catch (error) {
  fail(`could not read input PNG '${inputPath}': ${error.message}`);
}

const source = { width: inputPng.width, height: inputPng.height, data: inputPng.data };

let out;
try {
  out = command === "normal" ? generateNormalMap(source, params) : generateSpecularMap(source, params);
} catch (error) {
  fail(error.message);
}

const outputPng = new PNG({ width: out.width, height: out.height });
outputPng.data = Buffer.from(out.data);

try {
  writeFileSync(outputPath, PNG.sync.write(outputPng));
} catch (error) {
  fail(`could not write output PNG '${outputPath}': ${error.message}`);
}

process.stdout.write(`wrote ${command} map: ${outputPath}\n`);
