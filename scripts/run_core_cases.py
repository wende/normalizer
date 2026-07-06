#!/usr/bin/env python3
"""Run the current laigter-core CLI for every active manifest case."""

from __future__ import annotations

import argparse
import json
import subprocess
from pathlib import Path


PARAM_OPTIONS = {
    "normal_depth": "--normal-depth",
    "normal_blur_radius": "--normal-blur-radius",
    "normal_bisel_depth": "--normal-bisel-depth",
    "normal_bisel_distance": "--normal-bisel-distance",
    "normal_bisel_blur_radius": "--normal-bisel-blur-radius",
}

BOOL_OPTIONS = {
    "normal_bisel_soft": ("--hard-bisel", False),
    "invert_x": ("--invert-x", True),
    "invert_y": ("--invert-y", True),
    "invert_z": ("--invert-z", True),
    "use_normal_alpha": ("--use-normal-alpha", True),
}


def load_manifest(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def output_name(case: dict, map_name: str) -> str:
    return f"{case['id']}_{map_name}.png"


def normal_args(params: dict) -> list[str]:
    args: list[str] = []
    for name, option in PARAM_OPTIONS.items():
        if name in params:
            args.extend((option, str(params[name])))
    for name, (option, enabled_value) in BOOL_OPTIONS.items():
        if name in params and params[name] == enabled_value:
            args.append(option)
    return args


def run_case(repo: Path, cli: Path, case: dict, out_dir: Path) -> None:
    if not case.get("enabled", True):
        return
    if case.get("map") != "normal":
        raise RuntimeError(f"{case['id']}: current MVP runner only supports normal maps")

    input_path = repo / case["input"]
    output_path = out_dir / output_name(case, "normal")
    output_path.parent.mkdir(parents=True, exist_ok=True)

    cmd = [
        str(cli),
        "normal",
        str(input_path),
        str(output_path),
        *normal_args(case.get("params", {})),
    ]
    subprocess.run(cmd, cwd=repo, check=True)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", default="tests/golden/manifest.json")
    parser.add_argument("--cli", default="build/laigter-core-cli")
    parser.add_argument("--out-dir", default="tests/golden/current")
    parser.add_argument("--case", dest="case_id")
    args = parser.parse_args()

    repo = Path.cwd()
    manifest = load_manifest(repo / args.manifest)
    cases = manifest["cases"]
    if args.case_id:
        cases = [case for case in cases if case["id"] == args.case_id]
        if not cases:
            raise RuntimeError(f"unknown case: {args.case_id}")

    for case in cases:
        run_case(repo, repo / args.cli, case, repo / args.out_dir)

    print(f"wrote current outputs to {args.out_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
