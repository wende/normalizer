SMOKE_OUT ?= /tmp/normalizer_demo_n.png
WEB_PORT ?= 8765
UPSTREAM_LAIGTER ?=
UPSTREAM_BUILD_DIR ?= build/laigter-upstream
UPSTREAM_LAIGTER_BIN ?= $(UPSTREAM_BUILD_DIR)/laigter.app/Contents/MacOS/laigter

JS_CLI := cli/normalizer.js

.PHONY: all clean smoke web web-static install js-smoke fixtures current-goldens build-upstream-laigter regenerate-goldens regenerate-goldens-local preview-goldens preview-self-check

all: js-smoke

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

preview-goldens: fixtures
	node scripts/run_preview_cases.js --manifest tests/golden/manifest.json --out-dir $(PREVIEW_OUT)

# Self-consistency: rerun into a second dir, diff against the first.
preview-self-check: preview-goldens
	@rm -rf $(PREVIEW_RERUN)
	node scripts/run_preview_cases.js --manifest tests/golden/manifest.json --out-dir $(PREVIEW_RERUN)
	python3 scripts/diff_pngs.py --manifest tests/golden/manifest.json \
		--expected-dir $(PREVIEW_OUT) --actual-dir $(PREVIEW_RERUN) --map preview

fixtures:
	python3 scripts/generate_fixture_images.py

current-goldens: fixtures
	python3 scripts/run_core_cases.py --cli $(JS_CLI)

# Upstream Laigter build + golden regeneration: escape hatch only, needed solely
# to refresh tests/golden/upstream/*.png (upstream parity is no longer a gate).
build-upstream-laigter:
	@mkdir -p $(UPSTREAM_BUILD_DIR)
	cd $(UPSTREAM_BUILD_DIR) && qmake $(CURDIR)/laigter/laigter.pro CONFIG+=sdk_no_version_check QMAKE_CXXFLAGS+=-Wno-error=implicit-function-declaration
	$(MAKE) -C $(UPSTREAM_BUILD_DIR)

regenerate-goldens: fixtures
	@test -n "$(UPSTREAM_LAIGTER)" || (echo "Set UPSTREAM_LAIGTER=/path/to/upstream/laigter" && exit 2)
	python3 scripts/generate_goldens.py --upstream-cli "$(UPSTREAM_LAIGTER)"

regenerate-goldens-local: build-upstream-laigter fixtures
	python3 scripts/generate_goldens.py --upstream-cli "$(UPSTREAM_LAIGTER_BIN)"

clean:
	rm -rf build
