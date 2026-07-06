# Normalizer Feature Plan

Prioritized implement/defer/drop split of the remaining work from
[REWRITE_PLAN.md](REWRITE_PLAN.md), decided 2026-07-06.

## Decisions this plan is based on

- **Goal**: personal tool first, maybe public later — keep doors open cheaply.
- **Fidelity**: free to diverge from upstream Laigter. Output is judged on its
  own merits, not pixel-diffed against upstream. This invalidates the
  bit-exactness premise of REWRITE_PLAN.md (Phase 0 and the §3 "don't rewrite
  the math" argument).
- **Workflows that matter**: sprite sheets/animation, tileable textures,
  batch export. Not: custom heightmaps, painted overlays.

## Structural decision: JS/TS is the single source of truth

The repo currently has two implementations of the normal-map math:
`web/app.js` (browser) and `core/src/laigter_core.cpp` (native CLI). Every
new map type would double that work. Since upstream parity is no longer a
goal, the C++/CImg core loses its reason to exist.

**Decision**: extract the algorithms from `web/app.js` into a shared JS
module that runs in both the browser and a Node CLI. The C++ core
(`core/`) and the WASM plan (REWRITE_PLAN.md §3 Phase 1–2) are retired.
Consequences:

- Batch export ships as a Node CLI — no Tauri, no File System Access API.
- WASM build, Emscripten, TS wrapper, and WASM/core CI parity drop off the
  list entirely (not deferred — removed).
- The remaining map types (parallax/specular/occlusion) are
  threshold/contrast/blur/distance ops, simpler than the normal path already
  ported. Typed-array JS is fast enough at sprite scale; revisit WASM only
  if profiling demands it.

---

## 1. Implement now

Ordered. Parameter names, ranges, and defaults for each map come from the
inventory in REWRITE_PLAN.md §2.

1. **Shared algorithm module + Node CLI skeleton** — move generation code
   out of `web/app.js` into a module imported by both the browser app and a
   Node CLI. Prerequisite for everything below.
2. **Parallax map generation + panel** — Binary and HeightMap types only
   (Quantization/Intervals are unimplemented stubs upstream, see
   REWRITE_PLAN.md §2 and "Deliberately deferred"). Params: REWRITE_PLAN.md
   §2 "Parallax map" table.
3. **Specular map generation + panel** — params: §2 "Specular map" table.
4. **Occlusion map generation + panel** — params: §2 "Occlusion map" table,
   including distance mode (reuses the alpha distance transform from the
   normal bevel path).
5. **Export with suffix convention** — `_n/_p/_s/_o` per REWRITE_PLAN.md §2
   "Export / batch".
6. **Tileable 3×3 neighbour mosaics** — compute on mosaic, crop center, per
   REWRITE_PLAN.md §1 "Tileability". Do this before sprite sheets: the
   per-frame mosaic machinery builds on it, so the pipeline refactor happens
   once. Neighbour-image inputs (§2 "Inputs") can wait; plain tileX/tileY
   self-tiling first.
7. **Sprite-sheet splitting + animation playback** — `h_frames`/`v_frames`
   split, named frame lists, fps playback (REWRITE_PLAN.md §2 "Inputs",
   §3 Phase 3.7).
8. **Node CLI batch export** — folder scan, per-map suffixes, output dir,
   recursive, `--check-changes` mtime skip (REWRITE_PLAN.md §2
   "Export / batch"). Mirrors upstream's headless CLI (§1).

## 2. Implement cheaply alongside (hygiene, not features)

- **Single Web Worker recompute** — one worker + the existing debounce, not
  the per-map worker pool from REWRITE_PLAN.md §3 Phase 3.3. Occlusion's
  distance transform and large blurs will jank the main thread otherwise.
  Add the pool only if it ever hurts.
- **Self-regression goldens** — repurpose the existing harness
  (`tests/golden/`, `scripts/generate_goldens.py`, `scripts/diff_pngs.py`):
  pin our *own* CLI output as expected PNGs instead of upstream's.
  "Free to diverge" kills upstream parity, not refactor safety. Extend
  `tests/golden/manifest.json` as each map/feature lands, as its README
  already instructs.

## 3. Defer (real value, wrong time — with re-entry triggers)

| Item | Plan ref | Trigger to revisit |
|---|---|---|
| React + TS + Vite shell | §3 Phase 3.1 | Vanilla UI state handling starts fighting us (~4 more panels will roughly triple `app.js`). Cheap middle step available now: convert the shared module to TypeScript. |
| WebGL2 port of `fshader.glsl` + full lights/ambient/specular/parallax preview | §3 Phase 3.2, §2 "Preview-only" | When parallax generation lands — a parallax map you can't preview is hard to tune. |
| Custom heightmap / specular base inputs (UI) | §2 "Inputs" | User demand. Generation code keeps accepting an optional height/specular source so only UI is missing. |
| Paint overlays in UI | §3 "Deliberately deferred" | Same: core keeps accepting overlay buffers (already the upstream plan's stance). |
| Tauri desktop packaging | §3 Phase 3.1 | Only if folder-watch or distribution to non-terminal users becomes a goal; Node CLI covers batch until then. |
| Performance budget validation | §3 Phase 4.3 | Don't formalize; log recompute time in dev, look at it as each map lands. |
| New project zip format | §3 Phase 3.6 | Project firms up into a product. Until then: JSON settings export alongside PNGs. |

## 4. Drop (invalidated by the decisions above)

- **Upstream golden corpus / pixel-diff parity** (REWRITE_PLAN.md Phase 0,
  Phase 4.1) — non-goal under "free to diverge". The harness survives only
  in its self-regression role (§2 above).
- **WASM build, TS wrapper, Node WASM smoke test, WASM/core CI parity**
  (Phase 2, Phase 4.1) — mooted by the single-JS-implementation decision.
- **Legacy preset import** and **`.laigter` project import** (Phase 3.5–3.6)
  — only matter for migrating other people's Laigter projects. Formats are
  simple (plain-text presets per §1; zip projects); late implementation
  costs the same as early. Revisit only if this becomes a public successor.

## Known loss / escape hatch

Dropping upstream parity strands the C++ core and the golden-vs-upstream
tooling as sunk cost. Accepted. **Before deleting `core/` or
`tests/golden/upstream/`**: confirm `make regenerate-goldens` against an
upstream build still works, or keep the upstream PNGs checked in — rebuilding
upstream Laigter with Qt later is the expensive part if bit-exactness is
ever wanted again (REWRITE_PLAN.md Phase 0).
