/*
 * Laigter core rewrite MVP.
 *
 * This file is derived from Laigter's GPL-3.0 image processing logic.
 */

#ifndef LAIGTER_CORE_H
#define LAIGTER_CORE_H

#include <cstdint>
#include <vector>

namespace laigter {

struct Image {
  int width = 0;
  int height = 0;
  std::vector<std::uint8_t> rgba;
};

struct NormalParams {
  int normal_depth = 250;
  int normal_blur_radius = 6;
  int normal_bisel_depth = 100;
  int normal_bisel_distance = 60;
  int normal_bisel_blur_radius = 10;
  bool normal_bisel_soft = true;
  bool invert_x = false;
  bool invert_y = false;
  bool invert_z = false;
  bool use_normal_alpha = false;
};

struct NormalInputs {
  const Image* heightmap = nullptr;
  const Image* height_overlay = nullptr;
  const Image* normal_overlay = nullptr;
};

Image generate_normal_map(
    const Image& diffuse,
    const NormalParams& params = NormalParams(),
    const NormalInputs& inputs = NormalInputs());

}  // namespace laigter

#endif  // LAIGTER_CORE_H
