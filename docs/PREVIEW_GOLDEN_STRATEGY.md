# Preview golden strategy

## Current state

`tests/golden/manifest.json` contains six `preview_*` cases that exercise the
lit-preview renderer (`shared/preview.js`) at specific light positions and
toon settings. They exist to catch regressions in the lighting math.

`make golden` currently **fails** on all six:

```
FAIL preview_sample_center: missing upstream preview golden
  tests/golden/upstream/preview_sample_center_preview.png.
  Capture via the Laigter GUI: open the source image, set the light per
  case['light'], View Mode=Preview, File>Export Preview to the expected path.
```

The harness expects hand-captured PNGs from the original Qt Laigter GUI.
Those captures were never made, so the upstream-parity preview gate is dead.

Meanwhile `make preview-self-check` passes: it renders the cases twice with
the Node pipeline (`scripts/run_preview_cases.js`) and diffs the two runs.
That proves determinism, not correctness — a wrong-but-stable renderer would
pass.

## Options

### 1. Capture the missing upstream previews

Do what the error message says: build upstream Laigter (`make
build-upstream-laigter`), open each fixture, set the light, switch to
Preview mode, export, commit the six PNGs.

**Pros**
- Restores true upstream parity for the preview path.
- Keeps the existing `make golden` target green end-to-end.

**Cons**
- Requires a working Qt Laigter build — the exact thing
  `docs/NORMALIZER_FEATURES.md` calls expensive to reproduce.
- The web preview has already moved to WebGL2 (`web/src/litGL.js`) with
  specular maps and controls upstream does not have; upstream parity is no
  longer the goal ("free to diverge").
- Locks us to a renderer we intend to replace.

### 2. Drop the preview cases from upstream parity

Remove the six `preview_*` cases from `tests/golden/manifest.json` (or set
`enabled: false`), keep them only in the self-regression path.

**Pros**
- `make golden` goes green immediately.
- Matches the roadmap: `docs/NORMALIZER_FEATURES.md` §2 says the harness
  should pin **our own** output, not upstream's.
- No Qt dependency.

**Cons**
- We lose an upstream correctness reference for the lighting math.
- The self-regression check alone cannot catch "renderer was always wrong."

### 3. Convert preview cases to self-regression goldens

Pin the current Node preview output as the expected PNGs under
`tests/golden/node/`, and make `make golden` (or a new `make preview-golden`)
compare against those instead of `upstream/`.

**Pros**
- Keeps the six cases as an active regression gate.
- No Qt build, no upstream dependency.
- Aligns with the self-regression direction already used for normal maps.

**Cons**
- Bakes in whatever the renderer does today; if the current preview is
  wrong, we enshrine the bug.
- Requires a one-time human sanity check that the current previews look
  right before pinning.

## Recommendation

Do **option 3 now**, and keep the door open for option 1 later.

Concretely:

1. Run `make preview-goldens` to write the six preview PNGs into
   `tests/golden/node/`.
2. Eyeball them (or open them in the web UI) to confirm the lighting looks
   sensible.
3. Update `tests/golden/manifest.json` so the preview cases' expected
   directory is `tests/golden/node/` instead of `tests/golden/upstream/`.
4. Update `Makefile` so `make golden` runs both the normal self-regression
   (`js-smoke` + diff) and the preview self-regression (`preview-self-check`),
   dropping the upstream comparison for preview cases.
5. Leave `tests/golden/upstream/` checked in as the escape hatch; do not
   delete it.

If upstream preview parity is ever needed again, the six cases can be
re-enabled against freshly captured upstream PNGs without changing the
self-regression path.

## Immediate next step

Choose one:

- **A.** I implement option 3 (self-regression preview goldens) now.
- **B.** You capture the upstream previews (option 1) and I wire them in.
- **C.** Drop the preview cases entirely (option 2) and revisit when the
  WebGL2 preview stabilizes.
