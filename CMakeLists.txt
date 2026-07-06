cmake_minimum_required(VERSION 3.16)

project(normalizer LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

add_library(laigter_core
  core/src/laigter_core.cpp
)

target_include_directories(laigter_core
  PUBLIC
    ${CMAKE_CURRENT_SOURCE_DIR}/core/include
  PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/laigter/thirdparty
)

target_compile_definitions(laigter_core
  PRIVATE
    cimg_display=0
)

add_executable(laigter-core-cli
  core/tools/laigter_core_cli.cpp
)

target_include_directories(laigter-core-cli
  PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/laigter/thirdparty
)

target_compile_definitions(laigter-core-cli
  PRIVATE
    cimg_display=0
)

target_link_libraries(laigter-core-cli
  PRIVATE
    laigter_core
)
