/*
 * Laigter core rewrite MVP CLI.
 *
 * This file is derived from Laigter's GPL-3.0 image processing logic.
 */

#include "laigter_core.h"

#include <algorithm>
#include <cstdint>
#include <cstdlib>
#include <exception>
#include <fstream>
#include <iostream>
#include <iterator>
#include <stdexcept>
#include <string>
#include <vector>

#define MINIZ_NO_ARCHIVE_APIS
#include "miniz.h"

namespace {

void print_usage(const char* argv0) {
  std::cerr
      << "Usage:\n"
      << "  " << argv0 << " normal <input.png> <output.png> [options]\n\n"
      << "Options:\n"
      << "  --normal-depth <int>\n"
      << "  --normal-blur-radius <int>\n"
      << "  --normal-bisel-depth <int>\n"
      << "  --normal-bisel-distance <int>\n"
      << "  --normal-bisel-blur-radius <int>\n"
      << "  --hard-bisel\n"
      << "  --invert-x\n"
      << "  --invert-y\n"
      << "  --invert-z\n"
      << "  --use-normal-alpha\n";
}

int parse_int(const std::string& value, const std::string& option) {
  char* end = nullptr;
  const long parsed = std::strtol(value.c_str(), &end, 10);
  if (end == value.c_str() || *end != '\0') {
    throw std::invalid_argument(option + " expects an integer");
  }
  return static_cast<int>(parsed);
}

std::string require_value(const std::vector<std::string>& args, std::size_t& index) {
  if (index + 1 >= args.size()) {
    throw std::invalid_argument(args[index] + " expects a value");
  }
  ++index;
  return args[index];
}

std::uint32_t read_be32(const std::vector<std::uint8_t>& data, std::size_t offset) {
  if (offset + 4 > data.size()) {
    throw std::runtime_error("truncated PNG");
  }
  return (static_cast<std::uint32_t>(data[offset]) << 24) |
         (static_cast<std::uint32_t>(data[offset + 1]) << 16) |
         (static_cast<std::uint32_t>(data[offset + 2]) << 8) |
         static_cast<std::uint32_t>(data[offset + 3]);
}

std::vector<std::uint8_t> read_file(const std::string& path) {
  std::ifstream file(path, std::ios::binary);
  if (!file) {
    throw std::runtime_error("unable to open input: " + path);
  }

  return std::vector<std::uint8_t>(
      std::istreambuf_iterator<char>(file),
      std::istreambuf_iterator<char>());
}

void write_file(const std::string& path, const void* data, std::size_t size) {
  std::ofstream file(path, std::ios::binary);
  if (!file) {
    throw std::runtime_error("unable to open output: " + path);
  }
  file.write(static_cast<const char*>(data), static_cast<std::streamsize>(size));
  if (!file) {
    throw std::runtime_error("failed writing output: " + path);
  }
}

int channels_for_png_color_type(int color_type) {
  switch (color_type) {
    case 0:
      return 1;
    case 2:
      return 3;
    case 4:
      return 2;
    case 6:
      return 4;
    default:
      throw std::runtime_error("unsupported PNG color type: " + std::to_string(color_type));
  }
}

std::uint8_t paeth_predictor(std::uint8_t left, std::uint8_t up, std::uint8_t up_left) {
  const int p = static_cast<int>(left) + static_cast<int>(up) - static_cast<int>(up_left);
  const int pa = std::abs(p - static_cast<int>(left));
  const int pb = std::abs(p - static_cast<int>(up));
  const int pc = std::abs(p - static_cast<int>(up_left));

  if (pa <= pb && pa <= pc) {
    return left;
  }
  if (pb <= pc) {
    return up;
  }
  return up_left;
}

laigter::Image load_png_rgba(const std::string& path) {
  const std::vector<std::uint8_t> png = read_file(path);
  const std::uint8_t signature[8] = {137, 80, 78, 71, 13, 10, 26, 10};
  if (png.size() < 8 || !std::equal(std::begin(signature), std::end(signature), png.begin())) {
    throw std::runtime_error("input is not a PNG: " + path);
  }

  int width = 0;
  int height = 0;
  int bit_depth = 0;
  int color_type = 0;
  bool saw_ihdr = false;
  bool saw_iend = false;
  std::vector<std::uint8_t> idat;

  for (std::size_t cursor = 8; cursor + 12 <= png.size();) {
    const std::uint32_t length = read_be32(png, cursor);
    cursor += 4;
    if (cursor + 4 + length + 4 > png.size()) {
      throw std::runtime_error("truncated PNG chunk");
    }

    const std::string type(
        reinterpret_cast<const char*>(&png[cursor]),
        reinterpret_cast<const char*>(&png[cursor + 4]));
    cursor += 4;

    const std::size_t chunk_data = cursor;
    cursor += length;
    cursor += 4;  // CRC. The MVP reader skips validation.

    if (type == "IHDR") {
      if (length != 13) {
        throw std::runtime_error("invalid PNG IHDR length");
      }
      width = static_cast<int>(read_be32(png, chunk_data));
      height = static_cast<int>(read_be32(png, chunk_data + 4));
      bit_depth = png[chunk_data + 8];
      color_type = png[chunk_data + 9];
      const int compression = png[chunk_data + 10];
      const int filter = png[chunk_data + 11];
      const int interlace = png[chunk_data + 12];
      if (width <= 0 || height <= 0) {
        throw std::runtime_error("PNG has invalid dimensions");
      }
      if (bit_depth != 8) {
        throw std::runtime_error("only 8-bit PNGs are supported in this MVP");
      }
      if (compression != 0 || filter != 0 || interlace != 0) {
        throw std::runtime_error("only non-interlaced baseline PNGs are supported in this MVP");
      }
      channels_for_png_color_type(color_type);
      saw_ihdr = true;
    } else if (type == "IDAT") {
      idat.insert(idat.end(), png.begin() + static_cast<std::ptrdiff_t>(chunk_data),
                  png.begin() + static_cast<std::ptrdiff_t>(chunk_data + length));
    } else if (type == "IEND") {
      saw_iend = true;
      break;
    }
  }

  if (!saw_ihdr || !saw_iend || idat.empty()) {
    throw std::runtime_error("PNG is missing required chunks");
  }

  const int channels = channels_for_png_color_type(color_type);
  const std::size_t row_bytes = static_cast<std::size_t>(width) * static_cast<std::size_t>(channels);
  const std::size_t inflated_size = (row_bytes + 1) * static_cast<std::size_t>(height);
  std::vector<std::uint8_t> inflated(inflated_size);
  mz_ulong actual_size = static_cast<mz_ulong>(inflated.size());
  const int status = mz_uncompress(
      inflated.data(),
      &actual_size,
      idat.data(),
      static_cast<mz_ulong>(idat.size()));
  if (status != MZ_OK || actual_size != inflated_size) {
    throw std::runtime_error("failed to inflate PNG image data");
  }

  std::vector<std::uint8_t> raw(row_bytes * static_cast<std::size_t>(height));
  for (int y = 0; y < height; ++y) {
    const std::size_t src_row = static_cast<std::size_t>(y) * (row_bytes + 1);
    const std::size_t dst_row = static_cast<std::size_t>(y) * row_bytes;
    const std::size_t prior_row = y == 0 ? 0 : static_cast<std::size_t>(y - 1) * row_bytes;
    const int filter_type = inflated[src_row];

    for (std::size_t x = 0; x < row_bytes; ++x) {
      const std::uint8_t value = inflated[src_row + 1 + x];
      const std::uint8_t left = x >= static_cast<std::size_t>(channels) ? raw[dst_row + x - channels] : 0;
      const std::uint8_t up = y == 0 ? 0 : raw[prior_row + x];
      const std::uint8_t up_left =
          (y == 0 || x < static_cast<std::size_t>(channels)) ? 0 : raw[prior_row + x - channels];

      switch (filter_type) {
        case 0:
          raw[dst_row + x] = value;
          break;
        case 1:
          raw[dst_row + x] = static_cast<std::uint8_t>(value + left);
          break;
        case 2:
          raw[dst_row + x] = static_cast<std::uint8_t>(value + up);
          break;
        case 3:
          raw[dst_row + x] = static_cast<std::uint8_t>(value + ((static_cast<int>(left) + up) / 2));
          break;
        case 4:
          raw[dst_row + x] = static_cast<std::uint8_t>(value + paeth_predictor(left, up, up_left));
          break;
        default:
          throw std::runtime_error("unsupported PNG row filter");
      }
    }
  }

  laigter::Image image;
  image.width = width;
  image.height = height;
  image.rgba.resize(static_cast<std::size_t>(width) * static_cast<std::size_t>(height) * 4);

  for (int y = 0; y < height; ++y) {
    for (int x = 0; x < width; ++x) {
      const std::size_t raw_offset =
          (static_cast<std::size_t>(y) * static_cast<std::size_t>(width) + static_cast<std::size_t>(x)) *
          static_cast<std::size_t>(channels);
      const std::size_t rgba_offset =
          (static_cast<std::size_t>(y) * static_cast<std::size_t>(width) + static_cast<std::size_t>(x)) * 4;

      if (color_type == 0) {
        const std::uint8_t gray = raw[raw_offset];
        image.rgba[rgba_offset + 0] = gray;
        image.rgba[rgba_offset + 1] = gray;
        image.rgba[rgba_offset + 2] = gray;
        image.rgba[rgba_offset + 3] = 255;
      } else if (color_type == 2) {
        image.rgba[rgba_offset + 0] = raw[raw_offset + 0];
        image.rgba[rgba_offset + 1] = raw[raw_offset + 1];
        image.rgba[rgba_offset + 2] = raw[raw_offset + 2];
        image.rgba[rgba_offset + 3] = 255;
      } else if (color_type == 4) {
        const std::uint8_t gray = raw[raw_offset + 0];
        image.rgba[rgba_offset + 0] = gray;
        image.rgba[rgba_offset + 1] = gray;
        image.rgba[rgba_offset + 2] = gray;
        image.rgba[rgba_offset + 3] = raw[raw_offset + 1];
      } else {
        image.rgba[rgba_offset + 0] = raw[raw_offset + 0];
        image.rgba[rgba_offset + 1] = raw[raw_offset + 1];
        image.rgba[rgba_offset + 2] = raw[raw_offset + 2];
        image.rgba[rgba_offset + 3] = raw[raw_offset + 3];
      }
    }
  }

  return image;
}

void save_png_rgba(const laigter::Image& image, const std::string& path) {
  size_t png_size = 0;
  void* png_data = tdefl_write_image_to_png_file_in_memory_ex(
      image.rgba.data(),
      image.width,
      image.height,
      4,
      &png_size,
      MZ_DEFAULT_LEVEL,
      MZ_FALSE);
  if (png_data == nullptr) {
    throw std::runtime_error("failed to encode output PNG");
  }

  write_file(path, png_data, png_size);
  mz_free(png_data);
}

int run_normal(const std::vector<std::string>& args) {
  if (args.size() < 4) {
    print_usage(args[0].c_str());
    return 2;
  }

  const std::string input_path = args[2];
  const std::string output_path = args[3];
  laigter::NormalParams params;

  for (std::size_t i = 4; i < args.size(); ++i) {
    const std::string& arg = args[i];
    if (arg == "--normal-depth") {
      params.normal_depth = parse_int(require_value(args, i), arg);
    } else if (arg == "--normal-blur-radius") {
      params.normal_blur_radius = parse_int(require_value(args, i), arg);
    } else if (arg == "--normal-bisel-depth") {
      params.normal_bisel_depth = parse_int(require_value(args, i), arg);
    } else if (arg == "--normal-bisel-distance") {
      params.normal_bisel_distance = parse_int(require_value(args, i), arg);
    } else if (arg == "--normal-bisel-blur-radius") {
      params.normal_bisel_blur_radius = parse_int(require_value(args, i), arg);
    } else if (arg == "--hard-bisel") {
      params.normal_bisel_soft = false;
    } else if (arg == "--invert-x") {
      params.invert_x = true;
    } else if (arg == "--invert-y") {
      params.invert_y = true;
    } else if (arg == "--invert-z") {
      params.invert_z = true;
    } else if (arg == "--use-normal-alpha") {
      params.use_normal_alpha = true;
    } else {
      throw std::invalid_argument("unknown option: " + arg);
    }
  }

  const laigter::Image input = load_png_rgba(input_path);
  const laigter::Image output = laigter::generate_normal_map(input, params);
  save_png_rgba(output, output_path);

  std::cout << "wrote normal map: " << output_path << "\n";
  return 0;
}

}  // namespace

int main(int argc, char* argv[]) {
  const std::vector<std::string> args(argv, argv + argc);
  if (args.size() < 2 || args[1] == "--help" || args[1] == "-h") {
    print_usage(argv[0]);
    return args.size() < 2 ? 2 : 0;
  }

  try {
    if (args[1] == "normal") {
      return run_normal(args);
    }
    throw std::invalid_argument("unknown command: " + args[1]);
  } catch (const std::exception& error) {
    std::cerr << "error: " << error.what() << "\n\n";
    print_usage(argv[0]);
    return 1;
  }
}
