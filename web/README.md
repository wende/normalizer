# Laigter Web MVP

Start the local web server:

```sh
make web
```

Then open:

```text
http://localhost:8765/
```

The browser-only path still works by opening [index.html](index.html) directly
or running `make web-static`, but AI augmentation requires the Node server
because browsers cannot run `uv` directly.

This vertical slice loads the bundled sample image by default, accepts uploaded
images, generates a normal map in Canvas, updates on slider changes with a
40 ms debounce, includes the upstream Pixelated/Toon render toggles, and
exports the normal map as PNG.

The AI controls call the local `/api/normalcy/*` endpoints, which run the
vendored Normalcy project through `uv`. First use may download Python
dependencies and the MoGe ONNX model unless they are already cached.
