# Publish Checklist

Pre-flight for flipping `wende/normalizer` from private to public.
Audit run 2026-08-17 against `bbff0bb`.

## Already clean — no action needed

Verified, recorded here so nobody re-audits it:

- **No secrets.** Tracked tree *and* full history grepped for API keys, tokens,
  `.env`, private keys, AWS/GitHub/Slack credential patterns. Zero hits.
- **No personal paths or emails** in tracked source.
- **`.claude/` never committed** — gitignored from the first commit.
- **Repo size is fine.** 15 MB `.git`; largest blob is `web/demo.png` at 2.1 MB.
  No history rewrite needed for weight.
- **Submodule clean.** `laigter/` pinned to upstream `azagaya/laigter`
  @ `9b87b52`, no local modifications.
- **Gates pass.** `npm test` → 28 checks; `make js-smoke` clean;
  `npm run build` → 87 KB JS.

---

## MUST — legal blockers

### 1. Add the GPL-3.0 license text

`package.json` declares `"license": "GPL-3.0"` and ~15 files carry GPL
derivation headers, but **there is no `LICENSE` file**. GPL-3.0 §4–5 requires
distributing the license text with the work. Publishing Laigter-derived code
without it is a license violation.

```sh
curl -sL https://www.gnu.org/licenses/gpl-3.0.txt -o LICENSE
```

- [x] `LICENSE` added at repo root
- [x] Derivation credited in `README.md`: derived from
      [Laigter](https://github.com/azagaya/laigter) (GPL-3.0), and
      [DeepBump](https://github.com/HugoTini/DeepBump) (GPL-3.0) for the AI path

### 2. Decide on `"private": true`

`package.json` has `"private": true`, which blocks `npm publish`. Keep it if
this is not going to npm — but make it a decision, not a leftover.

- [ ] Confirmed intentional (keep) **or** removed with a publish plan

---

## SHOULD — before flipping the switch

### 3. Root `README.md`

The repo root currently has only `CLAUDE.md`. A public repo whose landing page
is an agent-instructions file reads as unfinished. `web/README.md` has good
content but is buried one level down.

- [x] `README.md` written (what it is, screenshot, quickstart, CLI usage,
      architecture pointer, license/attribution)

### 4. `third_party/normalcy/` is in git history

Added in `c19e327`, removed in `1abf4e2` ("Replace Normalcy AI with in-browser
DeepBump"). MIT-licensed, contains no secrets — but it is a separate project
that becomes permanently public and reachable via history. The only fix is a
history rewrite (`git filter-repo`), which breaks every existing clone and SHA.

- [x] Accepted as-is (decided 2026-08-17 — it is MIT and harmless)

### 5. Golden fixtures derive from upstream art

`tests/golden/manifest.json` feeds `laigter/images/sample.png` into 3 cases,
and `tests/golden/upstream/sample_defaults_normal.png` is a committed
derivative of it. `make smoke` does the same. Legally fine (both GPL-3.0), but
it contradicts the "never take assets from `laigter/`" rule in `CLAUDE.md` —
already flagged there as a known exception.

- [ ] Swapped to `web/demo.png`, **or** left alone with the exception noted

### 6. Clear `npm audit`

`npm audit fix` (non-breaking) reduces 6 → 4 vulnerabilities. Remaining 4
require `--force` (Vite 6 → 8, onnxruntime-node 1.22 → 1.21) — both dev/optional
chains, not shipped runtime. Acceptable to triage; Dependabot will reopen the
issue as upgrades land.

```sh
npm audit fix        # 6 → 4 (done 2026-08-17)
npm audit fix --force # would clear all, but breaks Vite and onnxruntime-node
```

- [x] `npm audit` triaged: 4 remaining are dev/optional, --force deferred

### 7. Add CI

`.github/workflows/ci.yml` now exists and runs `npm test` + `make js-smoke` +
`make preview-self-check` + `npm run build` on push/PR. Verified against a clean
clone.

- [x] `.github/workflows/ci.yml` running the gates
- [ ] Branch protection on `main` requiring the check (optional)

#### Known gap: no correctness gate

All current gates can pass while `shared/` output changes. Verified empirically
(2026-08-17): `npm test`, `make js-smoke`, and `make preview-self-check` all stay
green after an algorithm edit, because `js-smoke` diffs nothing and
`preview-self-check` generates both sides from the same code. A real gate needs
a **committed self-baseline** of the JS output plus a diff step — the
golden-harness repurposing planned in `docs/NORMALIZER_FEATURES.md` §2. The
blocker on this was retiring `core/` (#10), which is now done. The workflow
documents the gap in-line.

- [ ] Self-baseline committed and diffed in CI

### 8. Settle the working tree — DONE

Everything committed 2026-08-17 (`bcf7906` features + `demo/`, `bc96ace`
core retirement, `de3aca2` publish prep). `demo/` was committed whole —
5.5 MB, smaller than the original estimate — including `generate.sh` and
`PROMPTS.md` with the verbatim image-generation prompts.

- [x] Pending changes committed
- [x] Decision on `demo/`: committed (5.5 MB accepted)

---

## CAN — optional polish

### 9. GPL headers on remaining files

~20 files lack the derivation header (`shared/image.js`,
`shared/primitives.js`, all of `web/src/*.jsx`). Most are original work, so a
root `LICENSE` covers them; per-file headers are convention, not obligation.

- [ ] Headers added to originals (low priority)

### 10. Delete the retiring C++ core — DONE

`core/`, `CMakeLists.txt`, the C++ `Makefile` targets, and the `make golden` /
`preview-diff` upstream-parity targets were removed 2026-08-17.
`tests/golden/upstream/` stays checked in as the escape hatch;
`make regenerate-goldens-local` can still build upstream if it's ever needed.

- [x] `core/` removed

### 11. GitHub repo metadata

Description is empty. Homepage already points at `normalizer-red.vercel.app`.

- [ ] Description set
- [ ] Topics added (e.g. `normal-map`, `pbr`, `game-dev`, `pixel-art`, `laigter`)

### 12. `CLAUDE.md` stays

It is agent-facing but genuinely good architecture documentation. Keep it
public and link to it from `README.md`.

- [x] Linked from `README.md`

---

## Minimum to unblock

```sh
# decide remaining items, commit pending work + demo/ + LICENSE + README, then:
gh repo edit wende/normalizer --visibility public
```
