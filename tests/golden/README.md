# Golden-output validation

This harness runs the JS CLI over `tests/golden/manifest.json` and diffs PNG
output. Upstream parity is retired (declared dropped in
`docs/NORMALIZER_FEATURES.md` §4; the C++ core was removed 2026-08-17) — the
active checks are self-consistency and crash/contract coverage. All manifest
inputs are this repo's own assets (`web/demo.png` and the generated fixtures).

- **CLI smoke:** `make js-smoke` runs the Node CLI over every manifest case
  into `tests/golden/node/`. It verifies the CLI runs and writes output; it
  diffs nothing.
- **Preview self-consistency:** `make preview-self-check` renders the preview
  cases twice and diffs the runs. Catches nondeterminism, not regressions.

There is currently **no correctness gate**: nothing fails when `shared/`
output changes. The planned fix is a committed self-baseline of the JS output
plus a diff step against it (see `PUBLISH_CHECKLIST.md` #7).

```sh
make fixtures
make js-smoke
make preview-self-check
```

The manifest covers normal-map defaults and preview-lighting cases. Specular
and parallax are covered by unit tests (`tests/specular.test.js`,
`tests/parallax.test.js`, run via `npm test`) rather than golden cases.
