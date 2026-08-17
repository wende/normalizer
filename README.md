<div align="center">

# Normalizer

Generate **normal**, **specular**, **height**, and **ambient-occlusion** maps from a
single image — in your browser or from the command line. No server, no upload, no
account.

**[Try it → normalizer-red.vercel.app](https://normalizer-red.vercel.app)**

<img src="docs/images/app.gif" alt="Normalizer web app">

Built for 2D game art: sprites, tilesets, and hand-painted textures that need to
light convincingly in a 3D or 2.5D engine.

</div>

---

## What it does

Feed it a diffuse image and it derives the maps a modern material needs:

| Map | What it gives you |
|---|---|
| **Normal** | Per-pixel surface orientation — makes flat art catch light and shadow |
| **Specular** | Where the surface is glossy vs matte |
| **Height / parallax** | Depth for parallax occlusion mapping — relief that self-occludes |
| **Occlusion** | Contact shadows in creases and cavities |

Two generators produce normals, and you switch between them with one toggle:

- **Procedural** — an analytic emboss + bevel pipeline derived from
  [Laigter](https://github.com/azagaya/laigter). Fast, deterministic, crisp on
  pixel art and hard edges. Every parameter is a slider.
- **AI** — [DeepBump](https://github.com/HugoTini/DeepBump) inference running
  **entirely in your browser** via ONNX Runtime in a Web Worker. Reads global
  form from the image instead of gradients, so it handles painterly and
  photographic sources the procedural path flattens. Nothing is uploaded; the
  model is fetched once and cached locally.

They are never blended — the active pipeline drives every view and the export.
DeepBump produces normals only; specular, height, and occlusion are always
procedural.

## Quickstart

### Browser

Use the [hosted app](https://normalizer-red.vercel.app), or run it locally:

```sh
npm install
make web        # http://localhost:8765
```

Drop in an image, tune the sliders, and export. **Export PNG** saves the visible
map; **Export Pack** saves a ZIP with every map plus an engine-facing
`normalizer.json` manifest. **Save Project** writes a `.normalizer` file (source
+ maps + all settings) you can reopen later.

Full UI reference: [web/README.md](web/README.md).

### CLI

```sh
npm install

node cli/normalizer.js normal    sprite.png sprite_normal.png
node cli/normalizer.js specular  sprite.png sprite_spec.png
node cli/normalizer.js parallax  sprite.png sprite_height.png --parallax-type heightmap
node cli/normalizer.js occlusion sprite.png sprite_ao.png
node cli/normalizer.js ai        sprite.png sprite_normal.png   # DeepBump
```

Every slider in the UI has a matching flag. A few worth knowing:

```sh
# deeper relief, softer bevel
node cli/normalizer.js normal sprite.png out.png \
  --normal-depth 400 --normal-bisel-blur-radius 16

# pixel art: process at logical resolution, 4x4 art pixels
node cli/normalizer.js normal sprite.png out.png --pixel-size 4

# DirectX convention (flip green)
node cli/normalizer.js normal sprite.png out.png --invert-y
```

`node cli/normalizer.js` with no arguments prints the full flag reference.
Exit codes: `0` success, `1` runtime error, `2` usage error.

The `ai` subcommand needs the optional `onnxruntime-node` dependency and a local
`deepbump256.onnx` — see [tests/deepbump/README.md](tests/deepbump/README.md).

---

## Development

One implementation, two front-ends. The algorithms live in `shared/` as pure
functions over `{ width, height, data }` records — no DOM, no Node APIs — so the
browser app and the CLI run **identical** code.

```
shared/      pure algorithms (normal, specular, parallax, occlusion, primitives)
web/         Preact app + WebGL lit preview + DeepBump worker
cli/         Node CLI (pngjs I/O)
tests/       unit tests + golden-image harness
```

```sh
git clone https://github.com/wende/normalizer.git
cd normalizer
npm install

npm test           # unit tests
make baseline-check # generated-map regression images
npm run test:e2e   # browser UI flows
npm run build      # production build
```

Architecture notes and conventions are in
[CLAUDE.md](CLAUDE.md). Roadmap and design decisions are in [docs/](docs/).

---

## License & attribution

**GPL-3.0.** See [LICENSE](LICENSE).

This project is a derivative work and inherits its copyleft:

- **[Laigter](https://github.com/azagaya/laigter)** (GPL-3.0) by azagaya — the
  procedural normal/specular/parallax algorithms are ported from it. Files
  derived from it carry the attribution in their header.
- **[DeepBump](https://github.com/HugoTini/DeepBump)** (GPL-3.0) by HugoTini —
  the AI normal-map model and its tiling/inference math.
