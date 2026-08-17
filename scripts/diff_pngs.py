#!/usr/bin/env python3
"""Diff current generated PNGs against the committed JS baseline."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from golden_png import read_rgba_png


def load_manifest(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def output_name(case: dict, map_name: str) -> str:
    return f"{case['id']}_{map_name}.png"


def compare_pngs(expected_path: Path, actual_path: Path, max_channel_delta: int) -> dict:
    expected_w, expected_h, expected = read_rgba_png(expected_path)
    actual_w, actual_h, actual = read_rgba_png(actual_path)
    if (expected_w, expected_h) != (actual_w, actual_h):
        raise RuntimeError(
            f"dimension mismatch: expected {expected_w}x{expected_h}, got {actual_w}x{actual_h}"
        )

    max_delta = 0
    total_delta = 0
    pixels_over_tolerance = 0
    changed_pixels = 0
    channel_count = len(expected)

    for pixel in range(expected_w * expected_h):
        pixel_changed = False
        pixel_over = False
        for channel in range(4):
            index = pixel * 4 + channel
            delta = abs(expected[index] - actual[index])
            max_delta = max(max_delta, delta)
            total_delta += delta
            if delta:
                pixel_changed = True
            if delta > max_channel_delta:
                pixel_over = True
        if pixel_changed:
            changed_pixels += 1
        if pixel_over:
            pixels_over_tolerance += 1

    return {
        "width": expected_w,
        "height": expected_h,
        "max_delta": max_delta,
        "mean_delta": total_delta / channel_count,
        "changed_pixels": changed_pixels,
        "pixels_over_tolerance": pixels_over_tolerance,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", default="tests/golden/manifest.json")
    parser.add_argument("--expected-dir", default="tests/golden/baseline")
    parser.add_argument("--actual-dir", default="tests/golden/current")
    parser.add_argument("--case", dest="case_id")
    parser.add_argument("--map", dest="map_name", help="only run cases with this map type")
    args = parser.parse_args()

    repo = Path.cwd()
    manifest = load_manifest(repo / args.manifest)
    cases = manifest["cases"]
    if args.case_id:
        cases = [case for case in cases if case["id"] == args.case_id]
        if not cases:
            raise RuntimeError(f"unknown case: {args.case_id}")
    if args.map_name:
        cases = [case for case in cases if case.get("map") == args.map_name]
        if not cases:
            raise RuntimeError(f"no cases with map: {args.map_name}")

    failures = 0
    for case in cases:
        if not case.get("enabled", True):
            continue
        map_name = case["map"]
        expected_path = repo / args.expected_dir / output_name(case, map_name)
        actual_path = repo / args.actual_dir / output_name(case, map_name)
        tolerance = case.get("tolerance", {})
        max_channel_delta = int(tolerance.get("max_channel_delta", 0))
        max_pixels_over_tolerance = int(tolerance.get("max_pixels_over_tolerance", 0))

        if not expected_path.exists():
            failures += 1
            hint = "Generate reviewed expectations with make refresh-baseline."
            print(f"FAIL {case['id']}: missing {map_name} baseline {expected_path}. {hint}")
            continue
        if not actual_path.exists():
            failures += 1
            print(f"FAIL {case['id']}: missing current output {actual_path}")
            continue

        try:
            result = compare_pngs(expected_path, actual_path, max_channel_delta)
        except Exception as error:
            failures += 1
            print(f"FAIL {case['id']}: {error}")
            continue

        passed = result["pixels_over_tolerance"] <= max_pixels_over_tolerance
        status = "PASS" if passed else "FAIL"
        print(
            f"{status} {case['id']}: "
            f"{result['width']}x{result['height']}, "
            f"max_delta={result['max_delta']}, "
            f"mean_delta={result['mean_delta']:.4f}, "
            f"changed_pixels={result['changed_pixels']}, "
            f"pixels_over_tolerance={result['pixels_over_tolerance']}"
        )
        if not passed:
            failures += 1

    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
