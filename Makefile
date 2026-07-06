CXX ?= c++
BUILD_DIR ?= build
SMOKE_OUT ?= /tmp/laigter_core_sample_n.png
WEB_PORT ?= 8765

CPPFLAGS += -Icore/include -Ilaigter/thirdparty -Dcimg_display=0
CXXFLAGS ?= -std=c++17 -O2

CORE_OBJ := $(BUILD_DIR)/core/src/laigter_core.o
CLI_OBJ := $(BUILD_DIR)/core/tools/laigter_core_cli.o
CLI_BIN := $(BUILD_DIR)/laigter-core-cli

.PHONY: all clean smoke web

all: $(CLI_BIN)

smoke: $(CLI_BIN)
	$(CLI_BIN) normal laigter/images/sample.png $(SMOKE_OUT)

web:
	python3 -m http.server $(WEB_PORT)

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
