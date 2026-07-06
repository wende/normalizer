# Laigter Web MVP

Open [index.html](index.html) directly, or serve the repo root:

```sh
make web
```

Then open:

```text
http://localhost:8765/web/
```

This is a dependency-free browser vertical slice. It loads the bundled sample
image by default, accepts uploaded images, generates a normal map in Canvas,
updates on slider changes with a 40 ms debounce, includes the upstream
Pixelated/Toon render toggles, and exports the normal map as PNG.
