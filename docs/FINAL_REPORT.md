# Repository audit — final report

**Date:** 2026-07-28
**Branch:** `feat/parallax-map`
**Scope:** full-repo audit requested by user; items 1–3 implemented, invert decision documented, preview golden strategy elaborated.

---

## What was done

### 1. Fixed `edt1d` Float32 precision bug

`shared/primitives.js` had a Felzenszwalb 1D distance transform that dropped
leading zero seeds on `[0, 1e20, …]` runs because the parabola-intersection
numerator suffered catastrophic cancellation in Float32.

**Fix:** canonical loop that recomputes the intersection point `s` after
each `k -= 1` eviction.

**Verification:** brute-force comparison against exact distances on 5000
random 1D seeds — 0 errors after the fix (was ~4000/5000 wrong).

**Impact:** `alphaDistance`, the normal-map bevel, and the parallax HeightMap
bevel are now correct. Self-regression goldens (`tests/golden/node/`) were
regenerated with `make js-smoke`; unit tests still pass.

### 2. Added `npm test`

`package.json` now has:

```json
"test": "node tests/specular.test.js && node tests/parallax.test.js"
```

66 unit checks (specular + parallax + erode/dilate primitives + CLI wiring)
run with one command.

### 3. Updated stale documentation

| File | Changes |
|---|---|
| `docs/NORMALIZER_FEATURES.md` | Marked specular/parallax as DONE with commit hashes; updated §2 hygiene and §3 deferred tables to reflect actual state; added explicit note that invert X/Y/Z is CLI-only by design. |
| `web/README.md` | Documents all three map types, the 6-tab preview bar, and per-map export filenames; removed the false "Invert X/Y/Z in Normal tab" row; clarified DeepBump scope vs procedural specular/parallax. |
| `tests/golden/README.md` | Rewritten to describe the two golden modes (legacy upstream parity vs current self-regression) and which commands are the active gate. |
| `CLAUDE.md` | Updated `shared/` inventory (specular, parallax, erode/dilate), CLI subcommands, key references now point to `docs/`, added `npm test` and `make preview-self-check` to the command table. |
| `shared/*.js` | Updated doc-comment references to the moved markdown files. |

### 4. Documented invert decision

Invert X/Y/Z is **intentionally not exposed in the web UI**. It remains in
the shared generator and CLI as a pipeline-correction flag for batch/CLI
use; in the browser users can flip the source image instead. This is now
written down in `docs/NORMALIZER_FEATURES.md` and `web/README.md` so it is
not mistaken for an unfinished feature.

### 5. Moved all planning markdown into `docs/`

```
docs/
├── JS_CORE_MIGRATION.md
├── NORMALIZER_FEATURES.md
├── OCCLUSION_MAP_PLAN.md
├── PARALLAX_MAP_PLAN.md
├── PREVIEW_GOLDEN_STRATEGY.md   (new)
├── REWRITE_PLAN.md
└── SPECULAR_MAP_PLAN.md
```

All references in code comments, READMEs, and `CLAUDE.md` were updated.

---

## Current state of loose ends

### Shipped and working

- Normal, specular, and parallax generators end-to-end (`shared/`, CLI, web panels, preview tabs).
- DeepBump AI normal map in browser via Web Worker.
- WebGL2 lit preview (`web/src/litGL.js`) with specular-map support.
- `npm test` green; `make js-smoke` and `make preview-self-check` green.

### Still broken / open

- **`make golden` fails** on the six `preview_*` cases because upstream
  preview PNGs were never captured. Normal-map cases pass.
- JS CLI output diverges from upstream goldens (documented `gaussianBlur`
  difference + the now-fixed EDT). This is expected under "free to diverge"
  but means the upstream-parity gate is no longer meaningful for the JS
  pipeline.
- No CI configuration; tests are local-only.

### Not started (roadmap)

- Occlusion map (`docs/OCCLUSION_MAP_PLAN.md` is ready to implement).
- Export suffix convention (`_n/_p/_s/_o`).
- Tileable 3×3 mosaics.
- Sprite-sheet splitting + animation playback.
- CLI batch export (folder scan, recursion, `--check-changes`).
- Single Web Worker recompute.
- Full self-regression golden conversion (currently hybrid).

### Dead weight / hygiene

- `core/` C++ implementation only covers `normal`; per
  `docs/JS_CORE_MIGRATION.md` §7 it can be deleted once the JS CLI golden
  gate is fully repointed.
- `pnpm-lock.yaml` tracked alongside `package-lock.json` (npm is the real
  toolchain).
- `file:../treelocatorjs` dev dependencies in `package.json` break install
  on machines without that sibling repo.

### Escape hatch (do not delete)

`tests/golden/upstream/*.png` and the `laigter/` submodule stay checked in.
Rebuilding upstream Laigter with Qt is expensive; keep them as the reference
implementation.

---

## Preview golden strategy (elaborated)

The six failing `preview_*` cases are analyzed in
[`docs/PREVIEW_GOLDEN_STRATEGY.md`](PREVIEW_GOLDEN_STRATEGY.md).

**Recommendation:** convert them to self-regression goldens (pin current
Node output as expected) rather than capturing upstream previews or dropping
them. This keeps an active regression gate without a Qt dependency and
matches the roadmap direction.

**Options presented to user:**

- **A.** Implement self-regression preview goldens now.
- **B.** Capture upstream previews manually via Laigter GUI.
- **C.** Drop the preview cases entirely.

---

## Verification commands run

```sh
npm test                    # 66 checks passed
make js-smoke               # Node CLI goldens regenerated
make preview-self-check     # 6/6 preview cases PASS
node <brute-force edt1d>    # 0 errors on 5000 random seeds
```

---

## Files changed

- `shared/primitives.js` — edt1d fix + doc path updates
- `shared/parallax.js`, `shared/specular.js` — doc path updates
- `package.json` — `npm test` script
- `CLAUDE.md` — architecture, commands, references
- `web/README.md` — features, invert note, DeepBump scope
- `tests/golden/README.md` — rewritten golden-mode documentation
- `docs/NORMALIZER_FEATURES.md` — status updates, invert note
- `docs/PREVIEW_GOLDEN_STRATEGY.md` — new
- Six planning docs moved to `docs/`
