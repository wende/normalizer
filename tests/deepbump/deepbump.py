#!/usr/bin/env python3
"""
Minimal standalone DeepBump CLI: color image -> tangent-space normal map.

This is a self-contained, faithful port of DeepBump's `color_to_normals`
module (https://github.com/HugoTini/DeepBump, GPL-3.0). The tiling / merge /
normalize helpers below are lifted verbatim from DeepBump's utils_inference.py
so the output matches the original addon. It is intentionally a throwaway test
tool -- NOT wired into the normalizer pipeline.

Usage:
    python deepbump.py INPUT.png OUTPUT_normal.png [--overlap SMALL|MEDIUM|LARGE]

Requires: numpy, pillow, onnxruntime  (see requirements.txt)
Model:    deepbump256.onnx must sit next to this script (see README.md).
"""

import argparse
import pathlib
import sys

import numpy as np
from PIL import Image
import onnxruntime as ort


# --------------------------------------------------------------------------
# Tiling helpers (verbatim from DeepBump/utils_inference.py, GPL-3.0)
# --------------------------------------------------------------------------
def _pad(img, left, right, top, bottom):
    return np.pad(img, ((0, 0), (top, bottom), (left, right)), mode="wrap")


def tiles_split(img, tile_size, stride_size):
    tile_h, tile_w = tile_size
    stride_h, stride_w = stride_size
    img_h, img_w = img.shape[1], img.shape[2]

    assert (stride_h % 2 == 0) and (stride_w % 2 == 0)
    assert (stride_h >= tile_h / 2) and (stride_w >= tile_w / 2)
    assert (stride_h <= tile_h) and (stride_w <= tile_w)

    pad_h, pad_w = 0, 0
    remainer_h = (img_h - tile_h) % stride_h
    remainer_w = (img_w - tile_w) % stride_w
    if remainer_h != 0:
        pad_h = stride_h - remainer_h
    if remainer_w != 0:
        pad_w = stride_w - remainer_w
    if tile_h > img_h:
        pad_h = tile_h - img_h
    if tile_w > img_w:
        pad_w = tile_w - img_w

    pad_left = pad_w // 2 + stride_w
    pad_right = pad_left if pad_w % 2 == 0 else pad_left + 1
    pad_top = pad_h // 2 + stride_h
    pad_bottom = pad_top if pad_h % 2 == 0 else pad_top + 1
    img = _pad(img, pad_left, pad_right, pad_top, pad_bottom)
    img_h, img_w = img.shape[1], img.shape[2]

    h_range = ((img_h - tile_h) // stride_h) + 1
    w_range = ((img_w - tile_w) // stride_w) + 1
    tiles = []
    for h in range(0, h_range):
        for w in range(0, w_range):
            h_from, h_to = h * stride_h, h * stride_h + tile_h
            w_from, w_to = w * stride_w, w * stride_w + tile_w
            tiles.append(img[:, h_from:h_to, w_from:w_to])
    return tiles, (pad_left, pad_right, pad_top, pad_bottom)


def tiles_infer(tiles, ort_session, progress_callback=None):
    pred_tiles = []
    tiles_nb = len(tiles)
    if progress_callback is not None:
        progress_callback(0, tiles_nb)
    for i in range(tiles_nb):
        if progress_callback is not None:
            progress_callback(i + 1, tiles_nb)
        pred = ort_session.run(None, {"input": tiles[i : i + 1]})[0][0]
        pred_tiles.append(pred)
    return pred_tiles


def _corner_mask(side_length):
    corner = np.zeros([side_length, side_length])
    for h in range(0, side_length):
        for w in range(0, side_length):
            if h >= w:
                sh = h / (side_length - 1)
                corner[h, w] = 1 - sh
            if h <= w:
                sw = w / (side_length - 1)
                corner[h, w] = 1 - sw
    return corner - 0.25 * _scaling_mask(side_length)


def _scaling_mask(side_length):
    scaling = np.zeros([side_length, side_length])
    for h in range(0, side_length):
        for w in range(0, side_length):
            sh = h / (side_length - 1)
            sw = w / (side_length - 1)
            if h >= w and h <= side_length - w:
                scaling[h, w] = sw
            if h <= w and h <= side_length - w:
                scaling[h, w] = sh
            if h >= w and h >= side_length - w:
                scaling[h, w] = 1 - sh
            if h <= w and h >= side_length - w:
                scaling[h, w] = 1 - sw
    return 2 * scaling


def generate_mask(tile_size, stride_size):
    tile_h, tile_w = tile_size
    stride_h, stride_w = stride_size
    ramp_h = tile_h - stride_h
    ramp_w = tile_w - stride_w

    mask = np.ones((tile_h, tile_w))
    mask[ramp_h:-ramp_h, :ramp_w] = np.linspace(0, 1, num=ramp_w)
    mask[ramp_h:-ramp_h, -ramp_w:] = np.linspace(1, 0, num=ramp_w)
    mask[:ramp_h, ramp_w:-ramp_w] = np.transpose(
        np.linspace(0, 1, num=ramp_h)[None], (1, 0)
    )
    mask[-ramp_h:, ramp_w:-ramp_w] = np.transpose(
        np.linspace(1, 0, num=ramp_h)[None], (1, 0)
    )

    assert ramp_h == ramp_w
    corner = np.rot90(_corner_mask(ramp_h), 2)
    mask[:ramp_h, :ramp_w] = corner
    corner = np.flip(corner, 1)
    mask[:ramp_h, -ramp_w:] = corner
    corner = np.flip(corner, 0)
    mask[-ramp_h:, -ramp_w:] = corner
    corner = np.flip(corner, 1)
    mask[-ramp_h:, :ramp_w] = corner
    return mask


def tiles_merge(tiles, stride_size, img_size, paddings):
    _, tile_h, tile_w = tiles[0].shape
    pad_left, pad_right, pad_top, pad_bottom = paddings
    height = img_size[1] + pad_top + pad_bottom
    width = img_size[2] + pad_left + pad_right
    stride_h, stride_w = stride_size

    assert (stride_h % 2 == 0) and (stride_w % 2 == 0)
    assert (stride_h >= tile_h / 2) and (stride_w >= tile_w / 2)
    assert (stride_h <= tile_h) and (stride_w <= tile_w)

    merged = np.zeros((img_size[0], height, width))
    mask = generate_mask((tile_h, tile_w), stride_size)

    h_range = ((height - tile_h) // stride_h) + 1
    w_range = ((width - tile_w) // stride_w) + 1
    for h in range(0, h_range):
        for w in range(0, w_range):
            h_from, h_to = h * stride_h, h * stride_h + tile_h
            w_from, w_to = w * stride_w, w * stride_w + tile_w
            merged[:, h_from:h_to, w_from:w_to] += tiles[0] * mask
            del tiles[0]
    return merged[:, pad_top:-pad_bottom, pad_left:-pad_right]


def normalize(img):
    img = img - 0.5
    img = img / np.sqrt(np.sum(img * img, axis=0, keepdims=True))
    return (img * 0.5) + 0.5


# --------------------------------------------------------------------------
# color_to_normals (faithful to DeepBump/module_color_to_normals.py)
# --------------------------------------------------------------------------
OVERLAPS = {"SMALL": 256 // 6, "MEDIUM": 256 // 4, "LARGE": 256 // 2}


def color_to_normals(color_img, overlap, model_path, verbose=False):
    """color_img: float32 array C,H,W in [0,1] (RGB). Returns 3,H,W in [0,1]."""
    tile_size = 256
    stride_size = tile_size - OVERLAPS[overlap]

    # Remove alpha & convert to grayscale (plain mean, matches DeepBump)
    img = np.mean(color_img[0:3], axis=0, keepdims=True).astype(np.float32)

    tiles, paddings = tiles_split(
        img, (tile_size, tile_size), (stride_size, stride_size)
    )

    ort.disable_telemetry_events()
    session = ort.InferenceSession(
        str(model_path), providers=["CPUExecutionProvider"]
    )

    cb = (lambda c, t: print(f"  tile {c}/{t}", file=sys.stderr)) if verbose else None
    pred_tiles = tiles_infer(tiles, session, progress_callback=cb)

    pred = tiles_merge(
        pred_tiles, (stride_size, stride_size),
        (3, img.shape[1], img.shape[2]), paddings,
    )
    return normalize(pred)


def main():
    ap = argparse.ArgumentParser(description="DeepBump color -> normal map (standalone)")
    ap.add_argument("input", help="input color image")
    ap.add_argument("output", help="output normal map (png)")
    ap.add_argument(
        "--overlap", choices=["SMALL", "MEDIUM", "LARGE"], default="LARGE",
        help="tile overlap; LARGE = best quality / slowest (default)",
    )
    ap.add_argument(
        "--model", default=None,
        help="path to deepbump256.onnx (default: next to this script)",
    )
    ap.add_argument("-v", "--verbose", action="store_true")
    args = ap.parse_args()

    model_path = pathlib.Path(
        args.model or pathlib.Path(__file__).parent / "deepbump256.onnx"
    )
    if not model_path.exists():
        sys.exit(
            f"Model not found: {model_path}\n"
            "Download it (27MB):\n"
            "  curl -L -o deepbump256.onnx "
            "https://raw.githubusercontent.com/HugoTini/DeepBump/"
            "fad19ba87daed12b1d0410a57e74f3d79e82f78d/deepbump256.onnx"
        )

    # Load as RGB, to C,H,W float32 in [0,1]
    rgb = np.asarray(Image.open(args.input).convert("RGB"), dtype=np.float32) / 255.0
    color = np.transpose(rgb, (2, 0, 1))

    if args.verbose:
        print(f"Input {args.input}  {color.shape[2]}x{color.shape[1]}", file=sys.stderr)

    normal = color_to_normals(color, args.overlap, model_path, args.verbose)

    out = (np.transpose(normal, (1, 2, 0)) * 255.0).clip(0, 255).astype(np.uint8)
    Image.fromarray(out, "RGB").save(args.output)
    print(f"Wrote {args.output}")


if __name__ == "__main__":
    main()
