# Publish Checklist

Pre-flight for changing `wende/normalizer` from private to public. Refreshed
2026-08-17 after the final repository, history, dependency, browser, and GitHub
exposure audit.

## Repository ready

- [x] GPL-3.0 text is present in `LICENSE`.
- [x] Laigter and DeepBump derivation is credited in `README.md` and in the
      relevant source headers.
- [x] No upstream Laigter code, assets, submodule, or golden files remain in
      the current tree.
- [x] The three.js showcase is absent from `main` and its reachable history.
      Its 27 files are preserved only on the local `demo` branch; do not push
      that branch to the public repository.
- [x] The full reachable history of every remote branch was scanned for common
      credential formats, private keys, sensitive filenames, personal paths,
      and credential-like assignments. No hits.
- [x] Issues, pull requests, comments, recent Actions logs, and artifacts were
      checked for the same exposure patterns. No hits.
- [x] `.claude/`, local build output, browser artifacts, generated fixtures,
      and model files are ignored.
- [x] Root README includes a centered app capture, quickstart, CLI usage,
      architecture links, and license attribution.
- [x] The hosted app loads successfully; the next deployment includes the new
      favicon, which was verified against the local production toolchain.
- [x] The DeepBump model URL is pinned to immutable upstream commit
      `fad19ba87daed12b1d0410a57e74f3d79e82f78d`; its expected SHA-256 is
      documented in `tests/deepbump/README.md`.

## Install and dependency state

- [x] npm is the single package-manager path. The stale pnpm lockfile and local
      `../treelocatorjs` lock entries are removed.
- [x] `package.json` keeps `"private": true` intentionally. This repository is
      a web app and CLI source tree, not an npm package; the flag prevents an
      accidental registry publication and does not affect GitHub visibility.
- [x] The supported Node range is declared.
- [x] `npm ci` succeeds from a clean archive.
- [x] `npm audit` reports zero vulnerabilities. Vite is upgraded to 8.2.1 and
      the optional ONNX runtime uses the patched `adm-zip` 0.6 line.
- [x] Production dependency licenses are GPL-compatible.

## Verification gates

- [x] Unit tests pass.
- [x] `tests/golden/baseline/` contains reviewed normal and preview outputs.
- [x] `make baseline-check` compares current output with that baseline and
      fails on changes outside the manifest tolerances.
- [x] The production Vite build succeeds.
- [x] The browser suite passes all UI, preview, export, and project-file flows.
- [x] GitHub Actions runs unit tests, the baseline check, the production build,
      and browser tests with read-only repository permissions.
- [ ] Require the CI job on `main` after the repository becomes public. The
      current private-plan repository cannot create branch rulesets.

## GitHub presentation and security

- [x] Repository description set.
- [x] Homepage set to `https://normalizer-red.vercel.app`.
- [x] Topics set (`normal-map`, `pbr`, `game-development`, `pixel-art`,
      `texture-generation`, `preact`).
- [x] Dependency vulnerability alerts enabled.
- [ ] Visibility changed to public.

## Intentional public exposure

These are not code blockers, but should be understood before the visibility
change:

- The Git history contains the accepted, removed MIT-licensed
  `third_party/normalcy/` implementation.
- Commit metadata exposes `krzysztof@wende.dev` and `wende@hey.com`.
- Thirteen non-main remote branches will also become visible. They contain no
  detected secrets, but their heads predate the C++ core retirement; one also
  still contains `third_party/normalcy/`.

No further history rewrite is recommended. Delete obsolete remote branches
only if their collaboration history is no longer useful.

## Publication

Changing visibility remains an explicit owner action:

- [ ] Commit this final cleanup, then replace the remote `main` history with
      `git push --force-with-lease origin main`; confirm the expanded CI job is
      green. The force push is required because the nine commits beginning with
      the original demo introduction were rewritten to exclude `demo/`.
- [ ] Keep the local `demo` branch unpushed. Branches in a public GitHub
      repository are public too.

```sh
gh repo edit wende/normalizer --visibility public
```

After that succeeds, add a `main` ruleset requiring the CI job and mark the
visibility and branch-protection items complete.
