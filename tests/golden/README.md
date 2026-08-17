# Golden-output validation

This harness runs the JS implementation over `tests/golden/manifest.json` and
diffs its PNG output against the committed `tests/golden/baseline/`. Upstream
parity is retired; all inputs and expected files are this repo's own assets.

- **Regression check:** `make baseline-check` generates current normal and
  preview outputs into `tests/golden/current/` and compares them with the
  committed baseline using each manifest case's tolerance.
- **Refresh:** `make refresh-baseline` deliberately replaces the expected
  images after a reviewed algorithm change. Inspect the image diff before
  committing the refreshed files.
- **Smoke-only helpers:** `make js-smoke` and `make preview-self-check` remain
  available for focused local diagnostics.

```sh
make fixtures
make baseline-check
```

The manifest covers normal-map defaults and preview-lighting cases. Specular
and parallax are covered by unit tests (`tests/specular.test.js`,
`tests/parallax.test.js`, run via `npm test`) rather than golden cases.
