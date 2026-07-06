# Laigter Core MVP

This is the first vertical slice of the rewrite plan: a Qt-free C++ core API
and a native CLI that load a PNG, generate a normal map, and write a PNG.

Build with Make:

```sh
make
```

Smoke test:

```sh
make smoke
```

Run:

```sh
build/laigter-core-cli normal \
  laigter/images/sample.png \
  /tmp/sample_n.png
```

There is also a root `CMakeLists.txt` for environments that already have
CMake installed.

The slice intentionally starts with normal-map generation only. Parallax,
specular, occlusion, tileable neighbour mosaics, and WASM bindings are the next
steps once this native extraction can be compared against upstream golden PNGs.

The MVP PNG reader supports the common 8-bit, non-interlaced grayscale, RGB,
grayscale-alpha, and RGBA PNG formats. It deliberately skips palette and
interlaced PNG support for now.
