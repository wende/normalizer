// .normalizer project ZIP round-trip — no DOM; runnable via
//   node tests/projectFile.test.js

import { strict as assert } from "node:assert";
import pngjs from "pngjs";
import {
  ASSET_NAMES,
  PROJECT_FORMAT,
  PROJECT_VERSION,
  buildProjectArchive,
  buildProjectJson,
  parseProjectJson,
  suggestProjectFilename,
  unpackProjectArchive,
} from "../web/src/projectFile.js";

const { PNG } = pngjs;

let passed = 0;
function check(name, actual, expected) {
  assert.deepStrictEqual(actual, expected, name);
  passed += 1;
  console.log(`  ok: ${name}`);
}

function checkThrows(name, fn, message) {
  let threw = false;
  try {
    fn();
  } catch (err) {
    threw = true;
    if (message) assert.match(String(err.message), message, name);
  }
  assert.equal(threw, true, name);
  passed += 1;
  console.log(`  ok: ${name}`);
}

function rgbaImage(width, height, fill = [10, 20, 30, 255]) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = fill[0];
    data[i + 1] = fill[1];
    data[i + 2] = fill[2];
    data[i + 3] = fill[3];
  }
  return { width, height, data };
}

function encodePng(image) {
  const png = new PNG({ width: image.width, height: image.height });
  png.data.set(image.data);
  return PNG.sync.write(png);
}

async function main() {
  console.log("project.json");

  {
    const state = {
      source: rgbaImage(2, 2),
      proceduralNormal: rgbaImage(2, 2, [128, 128, 255, 255]),
      specularMap: null,
      parallaxMap: rgbaImage(2, 2, [40, 40, 40, 255]),
      occlusionMap: null,
      aiOverlay: rgbaImage(2, 2, [120, 130, 255, 255]),
      pipeline: "ai",
      tab: "parallax",
      mode: "lit",
      splitRatio: 0.35,
      light: { x: 12, y: -4 },
      viewTilt: { x: 0.1, y: -0.2 },
      normalControls: { normalDepth: 300 },
      lightControls: { diffuseIntensity: 90 },
      aiControls: { strength: 80 },
      specularControls: { specularThresh: 100 },
      parallaxControls: { previewParallaxDepth: 45 },
      occlusionControls: { occlusionBlur: 7 },
    };
    const json = buildProjectJson(state);
    check("format", json.format, PROJECT_FORMAT);
    check("version", json.version, PROJECT_VERSION);
    check("assets.source", json.assets.source, ASSET_NAMES.source);
    check("assets.normal present", json.assets.normal, ASSET_NAMES.normal);
    check("assets.specular null", json.assets.specular, null);
    check("assets.parallax present", json.assets.parallax, ASSET_NAMES.parallax);
    check("assets.occlusion null", json.assets.occlusion, null);
    check("assets.aiNormal present", json.assets.aiNormal, ASSET_NAMES.aiNormal);
    check("pipeline", json.pipeline, "ai");
    check("splitRatio", json.splitRatio, 0.35);

    const parsed = parseProjectJson(JSON.stringify(json));
    check("parse round-trip pipeline", parsed.pipeline, "ai");
    check("parse round-trip light", parsed.light, { x: 12, y: -4 });
    check("parse keeps normalDepth", parsed.normal.normalDepth, 300);
  }

  {
    checkThrows(
      "rejects wrong format",
      () => parseProjectJson({ format: "nope", version: 1, assets: { source: "source.png" } }),
      /Not a Normalizer project/,
    );
    checkThrows(
      "rejects wrong version",
      () => parseProjectJson({ format: PROJECT_FORMAT, version: 99, assets: { source: "source.png" } }),
      /Unsupported project version/,
    );
    checkThrows(
      "rejects missing source asset",
      () => parseProjectJson({ format: PROJECT_FORMAT, version: 1, assets: {} }),
      /assets\.source/,
    );
  }

  console.log("zip round-trip");

  {
    const source = rgbaImage(3, 2, [1, 2, 3, 255]);
    const normal = rgbaImage(3, 2, [127, 127, 255, 255]);
    const state = {
      source,
      proceduralNormal: normal,
      specularMap: null,
      parallaxMap: null,
      occlusionMap: null,
      aiOverlay: null,
      pipeline: "procedural",
      tab: "normal",
      mode: "normal",
      splitRatio: 0.5,
      light: { x: 1, y: 2 },
      viewTilt: { x: 0, y: 0 },
      normalControls: { normalDepth: 250, normalBlur: 6 },
      lightControls: { diffuseIntensity: 60 },
      aiControls: { strength: 100 },
      specularControls: { specularThresh: 127 },
      parallaxControls: { previewParallaxDepth: 30 },
      occlusionControls: { occlusionBlur: 10 },
    };

    const archive = await buildProjectArchive(state, encodePng);
    assert.ok(archive.byteLength > 32, "archive non-empty");
    const { meta, pngBytes } = unpackProjectArchive(archive);
    check("unpacked pipeline", meta.pipeline, "procedural");
    check("unpacked normalDepth", meta.normal.normalDepth, 250);
    check("source bytes present", pngBytes.source != null, true);
    check("normal bytes present", pngBytes.normal != null, true);
    check("specular omitted", pngBytes.specular, null);
    check("ai omitted", pngBytes.aiNormal, null);

    const srcPng = PNG.sync.read(Buffer.from(pngBytes.source));
    check("source size", [srcPng.width, srcPng.height], [3, 2]);
    check("source pixel0", [srcPng.data[0], srcPng.data[1], srcPng.data[2], srcPng.data[3]], [1, 2, 3, 255]);

    const nrmPng = PNG.sync.read(Buffer.from(pngBytes.normal));
    check("normal pixel0", [nrmPng.data[0], nrmPng.data[1], nrmPng.data[2]], [127, 127, 255]);
  }

  {
    check("filename from png", suggestProjectFilename("hero.png"), "hero.normalizer");
    check("filename from normalizer", suggestProjectFilename("hero.normalizer"), "hero.normalizer");
    check("filename default", suggestProjectFilename(null), "project.normalizer");
  }

  console.log(`\n${passed} checks passed`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
