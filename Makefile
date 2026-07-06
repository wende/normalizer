CXX ?= c++
BUILD_DIR ?= build
SMOKE_OUT ?= /tmp/laigter_core_sample_n.png
WEB_PORT ?= 8765
UPSTREAM_LAIGTER ?=
UPSTREAM_BUILD_DIR ?= build/laigter-upstream
UPSTREAM_LAIGTER_BIN ?= $(UPSTREAM_BUILD_DIR)/laigter.app/Contents/MacOS/laigter

CPPFLAGS += -Icore/include -Ilaigter/thirdparty -Dcimg_display=0
CXXFLAGS ?= -std=c++17 -O2

CORE_OBJ := $(BUILD_DIR)/core/src/laigter_core.o
CLI_OBJ := $(BUILD_DIR)/core/tools/laigter_core_cli.o
CLI_BIN := $(BUILD_DIR)/laigter-core-cli
JS_CLI := cli/normalizer.js

.PHONY: all clean smoke web web-static install js-smoke fixtures current-goldens build-upstream-laigter regenerate-goldens regenerate-goldens-local golden preview-goldens preview-self-check preview-diff

all: $(CLI_BIN)

smoke: $(CLI_BIN)
	$(CLI_BIN) normal laigter/images/sample.png $(SMOKE_OUT)

web:
	node web/server.js

web-static:
	python3 -m http.server $(WEB_PORT)

install:
	npm install

# Run the JS CLI over the golden manifest into a separate output dir, without
# disturbing the C++ golden gate (make golden). Requires `make install` first.
js-smoke: fixtures
	python3 scripts/run_core_cases.py --cli $(JS_CLI) --out-dir tests/golden/node

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

# Full preview gate: JS preview vs. upstream Laigter preview goldens.
preview-diff: preview-goldens
	python3 scripts/diff_pngs.py --manifest tests/golden/manifest.json \
		--expected-dir tests/golden/upstream --actual-dir $(PREVIEW_OUT) --map preview

fixtures:
	python3 scripts/generate_fixture_images.py

current-goldens: $(CLI_BIN) fixtures
	python3 scripts/run_core_cases.py --cli $(CLI_BIN)

build-upstream-laigter:
	@mkdir -p $(UPSTREAM_BUILD_DIR)
	cd $(UPSTREAM_BUILD_DIR) && qmake $(CURDIR)/laigter/laigter.pro CONFIG+=sdk_no_version_check QMAKE_CXXFLAGS+=-Wno-error=implicit-function-declaration
	$(MAKE) -C $(UPSTREAM_BUILD_DIR)

regenerate-goldens: fixtures
	@test -n "$(UPSTREAM_LAIGTER)" || (echo "Set UPSTREAM_LAIGTER=/path/to/upstream/laigter" && exit 2)
	python3 scripts/generate_goldens.py --upstream-cli "$(UPSTREAM_LAIGTER)"

regenerate-goldens-local: build-upstream-laigter fixtures
	python3 scripts/generate_goldens.py --upstream-cli "$(UPSTREAM_LAIGTER_BIN)"

golden: current-goldens
	python3 scripts/diff_pngs.py

$(CLI_BIN): $(CORE_OBJ) $(CLI_OBJ)
	@mkdir -p $(dir $@)
	$(CXX) $(CXXFLAGS) $^ -o $@

$(CORE_OBJ): core/src/laigter_core.cpp core/include/laigter_core.h
	@mkdir -p $(dir $@)
	$(CXX) $(CPPFLAGS) $(CXXFLAGS) -c $< -o $@

$(CLI_OBJ): core/tools/laigter_core_cli.cpp core/include/laigter_core.h
	@mkdir -p $(dir $@)
	$(CXX) $(CPPFLAGS) $(CXXFLAGS) -c $< -o $@

clean:
	rm -rf $(BUILD_DIR)
