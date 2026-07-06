#!/usr/bin/env python3
"""Regenerate upstream golden PNGs using a headless upstream Laigter binary."""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import tempfile
from pathlib import Path


def load_manifest(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def expected_upstream_name(input_path: Path, map_name: str) -> str:
    suffix = {"normal": "_n"}[map_name]
    return f"{input_path.stem}{suffix}{input_path.suffix}"


def output_name(case: dict, map_name: str) -> str:
    return f"{case['id']}_{map_name}.png"


def run_case(repo: Path, upstream_cli: Path, case: dict, out_dir: Path) -> None:
    if not case.get("enabled", True):
        return
    if case.get("map") != "normal":
        raise RuntimeError(f"{case['id']}: upstream MVP runner only supports normal maps")
    if case.get("params"):
        raise RuntimeError(f"{case['id']}: upstream preset generation for parameterized cases is not implemented yet")

    input_path = repo / case["input"]
    with tempfile.TemporaryDirectory(prefix="laigter-upstream-") as temp_name:
        temp_dir = Path(temp_name)
        cmd = [
            str(upstream_cli),
            "-g",
            "-d",
            str(input_path),
            "-n",
            "-l",
            str(temp_dir),
            "--flatten",
        ]
        subprocess.run(cmd, cwd=repo, check=True)
        generated = temp_dir / expected_upstream_name(input_path, "normal")
        if not generated.exists():
            raise RuntimeError(f"{case['id']}: upstream did not write expected output {generated}")
        destination = out_dir / output_name(case, "normal")
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(generated, destination)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", default="tests/golden/manifest.json")
    parser.add_argument("--upstream-cli", required=True)
    parser.add_argument("--out-dir", default="tests/golden/upstream")
    parser.add_argument("--case", dest="case_id")
    args = parser.parse_args()

    repo = Path.cwd()
    upstream_cli = Path(args.upstream_cli).expanduser()
    if not upstream_cli.exists():
        raise RuntimeError(f"upstream Laigter binary not found: {upstream_cli}")

    manifest = load_manifest(repo / args.manifest)
    cases = manifest["cases"]
    if args.case_id:
        cases = [case for case in cases if case["id"] == args.case_id]
        if not cases:
            raise RuntimeError(f"unknown case: {args.case_id}")

    for case in cases:
        run_case(repo, upstream_cli, case, repo / args.out_dir)

    print(f"wrote upstream goldens to {args.out_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
