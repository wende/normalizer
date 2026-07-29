#!/usr/bin/env node
/*
 * normalizer CLI — normal-, specular-, parallax-, occlusion-, and pixelfix-map
 * generation.
 *
 * Derived from Laigter's GPL-3.0 logic; mirrors the argument/exit contract of
 * core/tools/laigter_core_cli.cpp so scripts/run_core_cases.py can drive either
 * binary via its --cli flag. Reads an 8-bit PNG, writes an 8-bit RGBA map.
 */

import { readFileSync, writeFileSync } from "node:fs";
import pngjs from "pngjs";
import { generateNormalMap, DEFAULT_NORMAL_PARAMS } from "../shared/normal.js";
import { generateSpecularMap, DEFAULT_SPECULAR_PARAMS } from "../shared/specular.js";
import { generateParallaxMap, DEFAULT_PARALLAX_PARAMS } from "../shared/parallax.js";
import { generateOcclusionMap, DEFAULT_OCCLUSION_PARAMS } from "../shared/occlusion.js";
import { fixPixels, DEFAULT_PIXEL_FIXER_PARAMS } from "../shared/pixelFixer.js";

const { PNG } = pngjs;

const USAGE = [
  "usage: normalizer <command> <input.png> <output.png> [options]",
  "",
  "commands:",
  "  normal                           generate a tangent-space normal map",
  "  specular                         generate a specular reflectivity map",
  "  parallax                         generate a parallax (height) map",
  "  occlusion                        generate an ambient-occlusion map",
  "  pixelfix                         recover a low-res sprite from pseudo-pixel art",
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
  "  --pixel-size <int>               art-pixel block size; >1 = process at logical resolution (default 1)",
  "",
  "specular options:",
  "  --specular-thresh <int>          contrast pivot (default 127)",
  "  --specular-contrast <float>      contrast (default 1.0)",
  "  --specular-bright <int>          brightness offset (default 0)",
  "  --specular-blur <int>            blur sigma (default 3)",
  "  --specular-invert                invert the map",
  "  --use-specular-alpha             copy the source alpha into the output",
  "  --pixel-size <int>               art-pixel block size (default 1)",
  "",
  "parallax options:",
  "  --parallax-type <binary|heightmap>  type (default binary)",
  "  --parallax-max <int>             binary threshold / heightmap pivot (default 140)",
  "  --parallax-min <int>             binary floor (default 0)",
  "  --parallax-focus <int>           binary pre-blur sigma (default 2)",
  "  --parallax-soft <int>            post-blur sigma (default 3)",
  "  --parallax-erode-dilate <int>    >0 dilate / <0 erode, binary only (default 1)",
  "  --parallax-brightness <int>      heightmap brightness offset (default 0)",
  "  --parallax-contrast <float>      heightmap contrast (default 1.0)",
  "  --parallax-invert                invert the map",
  "  --use-parallax-alpha             copy the source alpha into the output",
  "  --pixel-size <int>               art-pixel block size (default 1)",
  "",
  "occlusion options:",
  "  --occlusion-thresh <int>         threshold + contrast pivot (default 1)",
  "  --occlusion-contrast <float>     contrast (default 1.0)",
  "  --occlusion-bright <int>         brightness offset (default 16)",
  "  --occlusion-blur <int>           blur sigma (default 3)",
  "  --occlusion-distance-mode <0|1>  distance-transform AO (default 1)",
  "  --occlusion-distance <int>       distance falloff scale (default 10)",
  "  --occlusion-invert               invert the map",
  "  --use-occlusion-alpha            copy the source alpha into the output",
  "  --pixel-size <int>               art-pixel block size (default 1)",
  "",
  "pixelfix options:",
  "  --pitch <int>                    cell size in source pixels (0 = auto)",
  "  --offset-x <int>                 grid origin X (-1 = auto)",
  "  --offset-y <int>                 grid origin Y (-1 = auto)",
  "  --min-pitch <int>                auto-detect lower bound (default 4)",
  "  --max-pitch <int>                auto-detect upper bound (default 64)",
  "  --alpha-threshold <int>          opaque sample cutoff (default 16)",
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
      case "--pixel-size":
        params.pixelSize = parseInt32(requireValue(args, (i += 1), arg), arg);
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
      case "--pixel-size":
        params.pixelSize = parseInt32(requireValue(args, (i += 1), arg), arg);
        break;
      default:
        fail(`unknown option: ${arg}`);
    }
  }
  return params;
}

function parseParallaxFlags(args) {
  const params = { ...DEFAULT_PARALLAX_PARAMS };
  for (let i = 3; i < args.length; i += 1) {
    const arg = args[i];
    switch (arg) {
      case "--parallax-type": {
        const v = requireValue(args, (i += 1), arg);
        if (v !== "binary" && v !== "heightmap") {
          fail(`${arg} must be binary or heightmap`);
        }
        params.parallaxType = v;
        break;
      }
      case "--parallax-max":
        params.parallaxMax = parseInt32(requireValue(args, (i += 1), arg), arg);
        break;
      case "--parallax-min":
        params.parallaxMin = parseInt32(requireValue(args, (i += 1), arg), arg);
        break;
      case "--parallax-focus":
        params.parallaxFocus = parseInt32(requireValue(args, (i += 1), arg), arg);
        break;
      case "--parallax-soft":
        params.parallaxSoft = parseInt32(requireValue(args, (i += 1), arg), arg);
        break;
      case "--parallax-erode-dilate":
        params.parallaxErodeDilate = parseInt32(requireValue(args, (i += 1), arg), arg);
        break;
      case "--parallax-brightness":
        params.parallaxBrightness = parseInt32(requireValue(args, (i += 1), arg), arg);
        break;
      case "--parallax-contrast":
        params.parallaxContrast = parseFloatNumber(requireValue(args, (i += 1), arg), arg);
        break;
      case "--parallax-invert":
        params.parallaxInvert = true;
        break;
      case "--use-parallax-alpha":
        params.useAlpha = true;
        break;
      case "--pixel-size":
        params.pixelSize = parseInt32(requireValue(args, (i += 1), arg), arg);
        break;
      default:
        fail(`unknown option: ${arg}`);
    }
  }
  return params;
}

function parseOcclusionFlags(args) {
  const params = { ...DEFAULT_OCCLUSION_PARAMS };
  for (let i = 3; i < args.length; i += 1) {
    const arg = args[i];
    switch (arg) {
      case "--occlusion-thresh":
        params.occlusionThresh = parseInt32(requireValue(args, (i += 1), arg), arg);
        break;
      case "--occlusion-contrast":
        params.occlusionContrast = parseFloatNumber(requireValue(args, (i += 1), arg), arg);
        break;
      case "--occlusion-bright":
        params.occlusionBright = parseInt32(requireValue(args, (i += 1), arg), arg);
        break;
      case "--occlusion-blur":
        params.occlusionBlur = parseInt32(requireValue(args, (i += 1), arg), arg);
        break;
      case "--occlusion-distance-mode":
        params.occlusionDistanceMode = parseInt32(requireValue(args, (i += 1), arg), arg) !== 0;
        break;
      case "--occlusion-distance":
        params.occlusionDistance = parseInt32(requireValue(args, (i += 1), arg), arg);
        break;
      case "--occlusion-invert":
        params.occlusionInvert = true;
        break;
      case "--use-occlusion-alpha":
        params.useAlpha = true;
        break;
      case "--pixel-size":
        params.pixelSize = parseInt32(requireValue(args, (i += 1), arg), arg);
        break;
      default:
        fail(`unknown option: ${arg}`);
    }
  }
  return params;
}

function parsePixelFixFlags(args) {
  const params = { ...DEFAULT_PIXEL_FIXER_PARAMS };
  for (let i = 3; i < args.length; i += 1) {
    const arg = args[i];
    switch (arg) {
      case "--pitch":
        params.pitch = parseInt32(requireValue(args, (i += 1), arg), arg);
        break;
      case "--offset-x":
        params.offsetX = parseInt32(requireValue(args, (i += 1), arg), arg);
        break;
      case "--offset-y":
        params.offsetY = parseInt32(requireValue(args, (i += 1), arg), arg);
        break;
      case "--min-pitch":
        params.minPitch = parseInt32(requireValue(args, (i += 1), arg), arg);
        break;
      case "--max-pitch":
        params.maxPitch = parseInt32(requireValue(args, (i += 1), arg), arg);
        break;
      case "--alpha-threshold":
        params.alphaThreshold = parseInt32(requireValue(args, (i += 1), arg), arg);
        break;
      default:
        fail(`unknown option: ${arg}`);
    }
  }
  return params;
}

const PARSERS = {
  normal: parseNormalFlags,
  specular: parseSpecularFlags,
  parallax: parseParallaxFlags,
  occlusion: parseOcclusionFlags,
  pixelfix: parsePixelFixFlags,
};

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
  const parser = PARSERS[command];
  if (!parser) {
    fail(`unknown command: ${command}`);
  }
  if (args.length < 3) {
    failUsage("missing input/output arguments");
  }

  return { command, inputPath: args[1], outputPath: args[2], params: parser(args) };
}

const GENERATORS = {
  normal: generateNormalMap,
  specular: generateSpecularMap,
  parallax: generateParallaxMap,
  occlusion: generateOcclusionMap,
  pixelfix: fixPixels,
};

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
  out = GENERATORS[command](source, params);
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
