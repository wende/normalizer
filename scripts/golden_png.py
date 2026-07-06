#!/usr/bin/env python3
"""Small PNG helpers for the golden-output tests.

The harness intentionally avoids Pillow so the validation path has no Python
package dependency. It supports the 8-bit, non-interlaced PNG formats used by
the fixtures and Laigter CLI outputs.
"""

from __future__ import annotations

import struct
import zlib
from pathlib import Path

PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


class PngError(RuntimeError):
    pass


def _chunk(kind: bytes, payload: bytes) -> bytes:
    crc = zlib.crc32(kind)
    crc = zlib.crc32(payload, crc) & 0xFFFFFFFF
    return struct.pack(">I", len(payload)) + kind + payload + struct.pack(">I", crc)


def write_rgba_png(path: str | Path, width: int, height: int, rgba: bytes | bytearray) -> None:
    if width <= 0 or height <= 0:
        raise PngError("PNG dimensions must be positive")
    if len(rgba) != width * height * 4:
        raise PngError("RGBA buffer size does not match dimensions")

    rows = bytearray()
    stride = width * 4
    for y in range(height):
        rows.append(0)
        start = y * stride
        rows.extend(rgba[start : start + stride])

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    data = PNG_SIGNATURE
    data += _chunk(b"IHDR", ihdr)
    data += _chunk(b"IDAT", zlib.compress(bytes(rows), level=9))
    data += _chunk(b"IEND", b"")
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_bytes(data)


def read_rgba_png(path: str | Path) -> tuple[int, int, bytes]:
    payload = Path(path).read_bytes()
    if not payload.startswith(PNG_SIGNATURE):
        raise PngError(f"{path} is not a PNG")

    cursor = len(PNG_SIGNATURE)
    width = height = None
    bit_depth = color_type = None
    idat = bytearray()

    while cursor + 12 <= len(payload):
        length = struct.unpack(">I", payload[cursor : cursor + 4])[0]
        cursor += 4
        kind = payload[cursor : cursor + 4]
        cursor += 4
        data = payload[cursor : cursor + length]
        cursor += length
        cursor += 4

        if kind == b"IHDR":
            width, height, bit_depth, color_type, compression, png_filter, interlace = struct.unpack(
                ">IIBBBBB", data
            )
            if bit_depth != 8 or compression != 0 or png_filter != 0 or interlace != 0:
                raise PngError(f"{path} uses an unsupported PNG encoding")
            if color_type not in (0, 2, 4, 6):
                raise PngError(f"{path} uses unsupported PNG color type {color_type}")
        elif kind == b"IDAT":
            idat.extend(data)
        elif kind == b"IEND":
            break

    if width is None or height is None or bit_depth is None or color_type is None:
        raise PngError(f"{path} is missing IHDR")
    if not idat:
        raise PngError(f"{path} has no image data")

    channels = {0: 1, 2: 3, 4: 2, 6: 4}[color_type]
    row_bytes = width * channels
    inflated = zlib.decompress(bytes(idat))
    expected_size = (row_bytes + 1) * height
    if len(inflated) != expected_size:
        raise PngError(f"{path} has unexpected inflated size")

    raw = bytearray(row_bytes * height)
    for y in range(height):
        src = y * (row_bytes + 1)
        dst = y * row_bytes
        prior = (y - 1) * row_bytes
        filter_type = inflated[src]

        for x in range(row_bytes):
            value = inflated[src + 1 + x]
            left = raw[dst + x - channels] if x >= channels else 0
            up = raw[prior + x] if y > 0 else 0
            up_left = raw[prior + x - channels] if y > 0 and x >= channels else 0

            if filter_type == 0:
                decoded = value
            elif filter_type == 1:
                decoded = value + left
            elif filter_type == 2:
                decoded = value + up
            elif filter_type == 3:
                decoded = value + ((left + up) // 2)
            elif filter_type == 4:
                p = left + up - up_left
                pa = abs(p - left)
                pb = abs(p - up)
                pc = abs(p - up_left)
                predictor = left if pa <= pb and pa <= pc else up if pb <= pc else up_left
                decoded = value + predictor
            else:
                raise PngError(f"{path} uses unsupported PNG row filter {filter_type}")

            raw[dst + x] = decoded & 0xFF

    rgba = bytearray(width * height * 4)
    for i in range(width * height):
        raw_offset = i * channels
        rgba_offset = i * 4
        if color_type == 0:
            gray = raw[raw_offset]
            rgba[rgba_offset : rgba_offset + 4] = bytes((gray, gray, gray, 255))
        elif color_type == 2:
            rgba[rgba_offset : rgba_offset + 4] = bytes(
                (raw[raw_offset], raw[raw_offset + 1], raw[raw_offset + 2], 255)
            )
        elif color_type == 4:
            gray = raw[raw_offset]
            rgba[rgba_offset : rgba_offset + 4] = bytes((gray, gray, gray, raw[raw_offset + 1]))
        else:
            rgba[rgba_offset : rgba_offset + 4] = raw[raw_offset : raw_offset + 4]

    return width, height, bytes(rgba)
