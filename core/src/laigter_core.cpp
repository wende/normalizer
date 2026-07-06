/*
 * Laigter core rewrite MVP.
 *
 * This file is derived from Laigter's GPL-3.0 image processing logic.
 */

#include "laigter_core.h"

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <stdexcept>
#include <string>

#ifndef cimg_display
#define cimg_display 0
#endif
#include "CImg.h"

namespace laigter {
namespace {

using cimg_library::CImg;

void validate_rgba(const Image& image, const char* name) {
  if (image.width <= 0 || image.height <= 0) {
    throw std::invalid_argument(std::string(name) + " must have positive dimensions");
  }

  const auto expected =
      static_cast<std::size_t>(image.width) * static_cast<std::size_t>(image.height) * 4;
  if (image.rgba.size() != expected) {
    throw std::invalid_argument(std::string(name) + " must contain width * height * 4 RGBA bytes");
  }
}

void validate_same_size(const Image& image, const Image& reference, const char* name) {
  validate_rgba(image, name);
  if (image.width != reference.width || image.height != reference.height) {
    throw std::invalid_argument(std::string(name) + " dimensions must match diffuse");
  }
}

std::size_t rgba_offset(int width, int x, int y) {
  return (static_cast<std::size_t>(y) * static_cast<std::size_t>(width) +
          static_cast<std::size_t>(x)) *
         4;
}

CImg<float> rgba_to_cimg(const Image& image) {
  CImg<float> out(image.width, image.height, 1, 4, 0);
  for (int y = 0; y < image.height; ++y) {
    for (int x = 0; x < image.width; ++x) {
      const std::size_t offset = rgba_offset(image.width, x, y);
      out(x, y, 0, 0) = image.rgba[offset + 0];
      out(x, y, 0, 1) = image.rgba[offset + 1];
      out(x, y, 0, 2) = image.rgba[offset + 2];
      out(x, y, 0, 3) = image.rgba[offset + 3];
    }
  }
  return out;
}

CImg<float> grayscale_from_rgba(const Image& image) {
  CImg<float> out(image.width, image.height, 1, 1, 0);
  for (int y = 0; y < image.height; ++y) {
    for (int x = 0; x < image.width; ++x) {
      const std::size_t offset = rgba_offset(image.width, x, y);
      const int alpha = image.rgba[offset + 3];
      const int r = alpha == 0 ? 0 : image.rgba[offset + 0];
      const int g = alpha == 0 ? 0 : image.rgba[offset + 1];
      const int b = alpha == 0 ? 0 : image.rgba[offset + 2];
      out(x, y) = static_cast<float>((11 * r + 16 * g + 5 * b) / 32);
    }
  }
  return out;
}

CImg<float> blank_overlay(int width, int height) {
  return CImg<float>(width, height, 1, 4, 0);
}

CImg<float> overlay_or_blank(const Image* overlay, const Image& reference, const char* name) {
  if (overlay == nullptr) {
    return blank_overlay(reference.width, reference.height);
  }

  validate_same_size(*overlay, reference, name);
  return rgba_to_cimg(*overlay);
}

CImg<float> calculate_distance(const CImg<float>& heightmap) {
  CImg<float> distance = heightmap.get_channel(3);
  distance.threshold(0.1f);

  for (int x = 0; x < distance.width(); ++x) {
    distance(x, 0) = 0.0f;
    distance(x, distance.height() - 1) = 0.0f;
  }
  for (int y = 0; y < distance.height(); ++y) {
    distance(0, y) = 0.0f;
    distance(distance.width() - 1, y) = 0.0f;
  }

  distance.distance(0.0f);
  return distance;
}

CImg<float> modify_distance(const CImg<float>& distance, const NormalParams& params) {
  CImg<float> dist(distance);

  if (params.normal_bisel_distance != 0) {
    dist *= 255.0f / static_cast<float>(params.normal_bisel_distance);
  } else {
    dist.threshold(0.1f);
    dist *= 255.0f;
  }

  dist.cut(0.0f, 255.0f);
  if (params.normal_bisel_soft) {
    dist = (1.0f - (dist / 255.0f - 1.0f).pow(2.0f)).sqrt() * 255.0f;
  }

  return dist;
}

CImg<float> calculate_normal(
    const CImg<float>& input,
    const CImg<float>& heightmap,
    const NormalParams& params,
    int depth,
    int blur_radius) {
  if (input.width() < 3 || input.height() < 3) {
    throw std::invalid_argument("normal generation requires images at least 3x3 pixels");
  }

  CImg<float> img(input);
  img.blur(static_cast<float>(blur_radius) / 3.0f);
  img /= 255.0f;

  const int width = img.width();
  const int height = img.height();
  CImg<float> normals(width, height, 1, 3, 0);

  const float invert_x = params.invert_x ? -1.0f : 1.0f;
  const float invert_y = params.invert_y ? -1.0f : 1.0f;

  for (int x = 0; x < width; ++x) {
    for (int y = 0; y < height; ++y) {
      if (heightmap(x, y, 0, 3) == 0.0f) {
        normals(x, y, 0, 0) = 0.0f;
        normals(x, y, 0, 1) = 0.0f;
        normals(x, y, 0, 2) = 1.0f;
        continue;
      }

      float dx = 0.0f;
      if (x == 0) {
        dx = -3.0f * img(x, y) + 4.0f * img(x + 1, y) - img(x + 2, y);
      } else if (x == width - 1) {
        dx = 3.0f * img(x, y) - 4.0f * img(x - 1, y) + img(x - 2, y);
      } else {
        dx = -img(x - 1, y) + img(x + 1, y);
      }

      float dy = 0.0f;
      if (y == 0) {
        dy = -3.0f * img(x, y) + 4.0f * img(x, y + 1) - img(x, y + 2);
      } else if (y == height - 1) {
        dy = 3.0f * img(x, y) - 4.0f * img(x, y - 1) + img(x, y - 2);
      } else {
        dy = -img(x, y - 1) + img(x, y + 1);
      }

      normals(x, y, 0, 0) = -dx * (static_cast<float>(depth) / 100.0f) * invert_x;
      normals(x, y, 0, 1) = dy * (static_cast<float>(depth) / 100.0f) * invert_y;
      normals(x, y, 0, 2) = 1.0f;
    }
  }

  return normals;
}

std::uint8_t to_byte(float value) {
  const float clamped = std::max(0.0f, std::min(255.0f, value));
  return static_cast<std::uint8_t>(clamped);
}

}  // namespace

Image generate_normal_map(
    const Image& diffuse,
    const NormalParams& params,
    const NormalInputs& inputs) {
  validate_rgba(diffuse, "diffuse");

  const Image& height_source = inputs.heightmap == nullptr ? diffuse : *inputs.heightmap;
  validate_same_size(height_source, diffuse, "heightmap");

  const CImg<float> current_heightmap = rgba_to_cimg(height_source);
  const CImg<float> gray = grayscale_from_rgba(height_source);
  const CImg<float> distance = calculate_distance(current_heightmap);
  const CImg<float> bevel_distance = modify_distance(distance, params);

  CImg<float> height_overlay = overlay_or_blank(inputs.height_overlay, diffuse, "height_overlay");
  const CImg<float> height_overlay_alpha = height_overlay.get_channel(3) / 255.0f;
  CImg<float> height_overlay_r = height_overlay.get_channel(0).mul(height_overlay_alpha);

  const CImg<float> emboss_normal =
      calculate_normal(gray * 10.0f, current_heightmap, params, params.normal_depth, params.normal_blur_radius);
  const CImg<float> distance_normal = calculate_normal(
      bevel_distance,
      current_heightmap,
      params,
      params.normal_bisel_depth * params.normal_bisel_distance,
      params.normal_bisel_blur_radius);
  const CImg<float> height_overlay_normal =
      calculate_normal(height_overlay_r, current_heightmap, params, 5000, 0);

  const CImg<float> normal_overlay = overlay_or_blank(inputs.normal_overlay, diffuse, "normal_overlay");

  Image out;
  out.width = diffuse.width;
  out.height = diffuse.height;
  out.rgba.resize(static_cast<std::size_t>(out.width) * static_cast<std::size_t>(out.height) * 4);

  const float invert_z = params.invert_z ? -1.0f : 1.0f;

  for (int y = 0; y < out.height; ++y) {
    for (int x = 0; x < out.width; ++x) {
      const float overlay_r = normal_overlay(x, y, 0, 0) / 255.0f * 2.0f - 1.0f;
      const float overlay_g = normal_overlay(x, y, 0, 1) / 255.0f * 2.0f - 1.0f;
      const float overlay_b = normal_overlay(x, y, 0, 2) / 255.0f * 2.0f - 1.0f;
      const float overlay_a = normal_overlay(x, y, 0, 3) / 255.0f;

      float nr = emboss_normal(x, y, 0, 0) * 1.5f + distance_normal(x, y, 0, 0) * 1.5f +
                 height_overlay_normal(x, y, 0, 0);
      float ng = emboss_normal(x, y, 0, 1) * 1.5f + distance_normal(x, y, 0, 1) * 1.5f +
                 height_overlay_normal(x, y, 0, 1);
      float nb = (emboss_normal(x, y, 0, 2) * 1.5f + distance_normal(x, y, 0, 2) * 1.5f +
                  height_overlay_normal(x, y, 0, 2)) *
                 invert_z;

      nr = nr * (1.0f - overlay_a) + overlay_r * overlay_a;
      ng = ng * (1.0f - overlay_a) + overlay_g * overlay_a;
      nb = nb * (1.0f - overlay_a) + overlay_b * overlay_a;

      const float norm = std::sqrt(nr * nr + ng * ng + nb * nb);
      const std::size_t offset = rgba_offset(out.width, x, y);
      if (norm > 0.0f) {
        out.rgba[offset + 0] = to_byte(255.0f * (nr / norm * 0.5f + 0.5f));
        out.rgba[offset + 1] = to_byte(255.0f * (ng / norm * 0.5f + 0.5f));
        out.rgba[offset + 2] = to_byte(255.0f * (nb / norm * 0.5f + 0.5f));
      } else {
        out.rgba[offset + 0] = 127;
        out.rgba[offset + 1] = 127;
        out.rgba[offset + 2] = 255;
      }
      out.rgba[offset + 3] = params.use_normal_alpha ? diffuse.rgba[offset + 3] : 255;
    }
  }

  return out;
}

}  // namespace laigter
