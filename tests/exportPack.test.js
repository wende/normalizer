// Export Pack — normalizer.json + ZIP layout. No DOM; runnable via
//   node tests/exportPack.test.js

import { strict as assert } from "node:assert";
import pngjs from "pngjs";
import { unzipSync, strFromU8 } from "fflate";
import {
  MATERIAL_FORMAT,
  MATERIAL_VERSION,
  MAP_SUFFIXES,
  sanitizeBaseName,
  mapFilename,
  buildMaterialManifest,
  parseMaterialManifest,
  buildExportArchive,
  singleMapFilename,
} from "../web/src/exportPack.js";

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
  console.log("naming");

  check("sanitize strips extension", sanitizeBaseName("brick.png"), "brick");
  check("sanitize strips path", sanitizeBaseName("/tmp/foo/Brick Wall.PNG"), "Brick_Wall");
  check("sanitize empty → texture", sanitizeBaseName(""), "texture");
  check("mapFilename height", mapFilename("brick", "height"), "brick_height.png");
  check("mapFilename occlusion → ao", mapFilename("brick", "occlusion"), "brick_ao.png");
  check("singleMapFilename normal", singleMapFilename("hero", "normal"), "hero_normal.png");

  console.log("manifest");

  {
    const json = buildMaterialManifest({ baseName: "brick.png" });
    check("format", json.format, MATERIAL_FORMAT);
    check("version", json.version, MATERIAL_VERSION);
    check("usage default sprite", json.usage, "sprite");
    check("normalConvention y+", json.normalConvention, "y+");
    check("heightPolarity white-high", json.heightPolarity, "white-high");
    check("alphaMode source", json.alphaMode, "source");
    check("frames 1x1", json.frames, { horizontal: 1, vertical: 1 });
    check("maps.albedo", json.maps.albedo, "brick_albedo.png");
    check("maps.normal", json.maps.normal, "brick_normal.png");
    check("maps.height", json.maps.height, "brick_height.png");
    check("maps.occlusion", json.maps.occlusion, "brick_ao.png");
    check("maps.specular", json.maps.specular, "brick_specular.png");
    check("all map keys present", Object.keys(json.maps).sort(), Object.keys(MAP_SUFFIXES).sort());

    const parsed = parseMaterialManifest(JSON.stringify(json));
    check("parse round-trip maps", parsed.maps, json.maps);
    check("parse round-trip frames", parsed.frames, json.frames);
  }

  {
    const json = buildMaterialManifest({
      baseName: "tile",
      usage: "mesh",
      normalConvention: "y-",
      heightPolarity: "black-high",
      alphaMode: "opaque",
      frames: { horizontal: 4, vertical: 2 },
      mapsPresent: { albedo: true, normal: true, height: false, occlusion: false, specular: true },
    });
    check("mesh usage", json.usage, "mesh");
    check("y- convention", json.normalConvention, "y-");
    check("black-high", json.heightPolarity, "black-high");
    check("opaque alpha", json.alphaMode, "opaque");
    check("sprite frames", json.frames, { horizontal: 4, vertical: 2 });
    check("omitted height", json.maps.height, undefined);
    check("omitted occlusion", Object.prototype.hasOwnProperty.call(json.maps, "occlusion"), false);
    check("kept specular", json.maps.specular, "tile_specular.png");
  }

  {
    checkThrows(
      "rejects wrong format",
      () => parseMaterialManifest({ format: "normalizer-project", version: 1, maps: {} }),
      /Not a Normalizer material/,
    );
    checkThrows(
      "rejects bad version",
      () => parseMaterialManifest({ format: MATERIAL_FORMAT, version: 99, maps: { albedo: "a.png" } }),
      /Unsupported material pack version/,
    );
    checkThrows(
      "rejects empty maps",
      () => parseMaterialManifest({ format: MATERIAL_FORMAT, version: 1, maps: {} }),
      /albedo or normal/,
    );
  }

  console.log("archive");

  {
    const { bytes, manifest, filename } = await buildExportArchive({
      baseName: "brick wall.png",
      images: {
        albedo: rgbaImage(2, 2, [200, 100, 50, 255]),
        normal: rgbaImage(2, 2, [128, 128, 255, 255]),
        height: rgbaImage(2, 2, [40, 40, 40, 255]),
        occlusion: rgbaImage(2, 2, [180, 180, 180, 255]),
        specular: rgbaImage(2, 2, [90, 90, 90, 255]),
      },
      encodePng,
    });
    check("zip filename", filename, "brick_wall.zip");
    check("manifest base names", manifest.maps.albedo, "brick_wall_albedo.png");

    const files = unzipSync(bytes);
    const names = Object.keys(files).sort();
    check("zip layout", names, [
      "brick_wall/brick_wall_albedo.png",
      "brick_wall/brick_wall_ao.png",
      "brick_wall/brick_wall_height.png",
      "brick_wall/brick_wall_normal.png",
      "brick_wall/brick_wall_specular.png",
      "brick_wall/normalizer.json",
    ].sort());

    const packed = parseMaterialManifest(strFromU8(files["brick_wall/normalizer.json"]));
    check("zip manifest maps", packed.maps, manifest.maps);

    const albedoPng = PNG.sync.read(Buffer.from(files["brick_wall/brick_wall_albedo.png"]));
    check("albedo png size", [albedoPng.width, albedoPng.height], [2, 2]);
  }

  {
    const { bytes, manifest } = await buildExportArchive({
      baseName: "hero",
      images: {
        albedo: rgbaImage(1, 1),
        normal: rgbaImage(1, 1, [128, 128, 255, 255]),
        // height / occlusion / specular omitted
      },
      encodePng,
    });
    check("partial maps only albedo+normal", Object.keys(manifest.maps).sort(), ["albedo", "normal"]);
    const files = unzipSync(bytes);
    check(
      "partial zip file count",
      Object.keys(files).length,
      3, // albedo + normal + normalizer.json
    );
  }

  {
    await assert.rejects(
      () => buildExportArchive({ images: {}, encodePng }),
      /Nothing to export/,
    );
    passed += 1;
    console.log("  ok: empty images throws");
  }

  console.log(`\n${passed} checks passed`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
