# Golden-output validation

This harness compares CLI output against checked-in PNGs. It currently has
two modes:

- **Upstream parity (legacy):** `make golden` builds `build/laigter-core-cli`,
  regenerates `tests/golden/current/`, and compares against
  `tests/golden/upstream/` (PNGs captured from the original Qt Laigter). The
  normal-map cases pass; the six `preview_*` cases fail because their
  upstream preview PNGs were never captured.
- **Self-regression (current):** `make js-smoke` runs the Node CLI into
  `tests/golden/node/`; `make preview-self-check` reruns the preview cases
  and diffs Node output against itself. These pass and are the active gate
  for JS changes.

```sh
make fixtures
make regenerate-goldens UPSTREAM_LAIGTER=/path/to/upstream/laigter   # only if refreshing upstream PNGs
make golden          # legacy upstream parity (preview cases currently FAIL)
make js-smoke        # Node CLI self-regression
make preview-self-check
```

The manifest covers normal-map defaults and preview-lighting cases. Specular
and parallax are covered by unit tests (`tests/specular.test.js`,
`tests/parallax.test.js`, run via `npm test`) rather than golden cases.

Per `docs/NORMALIZER_FEATURES.md` §2, the upstream-parity mode is being
retired in favour of self-regression; the upstream PNGs stay checked in as
an escape hatch.
