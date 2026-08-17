SMOKE_OUT ?= /tmp/normalizer_demo_n.png
WEB_PORT ?= 8765

JS_CLI := cli/normalizer.js

.PHONY: all clean smoke web web-static install js-smoke fixtures current-goldens preview-goldens preview-self-check refresh-baseline baseline-check

all: baseline-check

# CLI smoke: normal map from the bundled demo image. Requires `make install` first.
smoke:
	node $(JS_CLI) normal web/demo.png $(SMOKE_OUT)

web:
	npx vite --port $(WEB_PORT) --strictPort

web-static:
	python3 -m http.server $(WEB_PORT)

install:
	npm install

# Run the JS CLI over the golden manifest. Requires `make install` first.
js-smoke: fixtures
	python3 scripts/run_core_cases.py --out-dir tests/golden/node

# Render preview cases via the JS core into $(PREVIEW_OUT). Requires `make install` first.
PREVIEW_OUT ?= tests/golden/node
PREVIEW_RERUN ?= tests/golden/node-rerun
BASELINE_OUT ?= tests/golden/baseline
BASELINE_CHECK_OUT ?= tests/golden/current

preview-goldens: fixtures
	node scripts/run_preview_cases.js --manifest tests/golden/manifest.json --out-dir $(PREVIEW_OUT)

# Self-consistency: rerun into a second dir, diff against the first.
preview-self-check: preview-goldens
	@rm -rf $(PREVIEW_RERUN)
	node scripts/run_preview_cases.js --manifest tests/golden/manifest.json --out-dir $(PREVIEW_RERUN)
	python3 scripts/diff_pngs.py --manifest tests/golden/manifest.json \
		--expected-dir $(PREVIEW_OUT) --actual-dir $(PREVIEW_RERUN) --map preview

# Explicit maintainer action: bless the current JS output as the new baseline.
refresh-baseline: fixtures
	python3 scripts/run_core_cases.py --out-dir $(BASELINE_OUT)
	node scripts/run_preview_cases.js --manifest tests/golden/manifest.json --out-dir $(BASELINE_OUT)

# CI correctness gate: current output must stay within each case's tolerance.
baseline-check: fixtures
	python3 scripts/run_core_cases.py --out-dir $(BASELINE_CHECK_OUT)
	node scripts/run_preview_cases.js --manifest tests/golden/manifest.json --out-dir $(BASELINE_CHECK_OUT)
	python3 scripts/diff_pngs.py --manifest tests/golden/manifest.json \
		--expected-dir $(BASELINE_OUT) --actual-dir $(BASELINE_CHECK_OUT) --map normal
	python3 scripts/diff_pngs.py --manifest tests/golden/manifest.json \
		--expected-dir $(BASELINE_OUT) --actual-dir $(BASELINE_CHECK_OUT) --map preview

fixtures:
	python3 scripts/generate_fixture_images.py

current-goldens: fixtures
	python3 scripts/run_core_cases.py --cli $(JS_CLI)

clean:
	rm -rf build
