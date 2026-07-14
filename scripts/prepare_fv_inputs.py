#!/usr/bin/env python3
"""Materialize and verify the exact raw inputs used by the FV reports.

The raw working directory stays gitignored. Immutable public sources are fetched
from pinned URLs; mutable DARKO/EPM inputs are copied from committed snapshots.
``--refresh`` checks current provider bytes separately and fails explicitly on
drift instead of silently changing the model output.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any, Callable

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from nba_stock_market.epm_data import fetch_season_snapshot, write_snapshot


DEFAULT_MANIFEST = ROOT / "data/manifests/fv-inputs.json"
DEFAULT_OUTPUT_DIR = ROOT / "data/raw/opening"
Download = Callable[[str, Path], None]


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def verify_file(path: Path, expected_sha256: str) -> None:
    actual = sha256_file(path)
    if actual != expected_sha256:
        raise ValueError(
            f"input drift for {path.name}: expected {expected_sha256}, got {actual}"
        )


def _download(url: str, destination: Path) -> None:
    with destination.open("wb") as handle:
        subprocess.run(
            [
                "curl",
                "--location",
                "--fail",
                "--silent",
                "--show-error",
                "--max-time",
                "60",
                "--user-agent",
                "NBAStockMarket-fv-bootstrap/1.0",
                url,
            ],
            check=True,
            stdout=handle,
        )


def _atomic_target(destination: Path) -> Path:
    return destination.with_name(f".{destination.name}.{os.getpid()}.tmp")


def _materialize_download(
    item: dict[str, Any],
    output_dir: Path,
    *,
    download: Download,
    refresh: bool,
) -> Path:
    destination = output_dir / item["filename"]
    if destination.exists() and not refresh:
        verify_file(destination, item["sha256"])
        return destination

    temporary = _atomic_target(destination)
    try:
        download(item["url"], temporary)
        verify_file(temporary, item["sha256"])
        temporary.replace(destination)
    finally:
        temporary.unlink(missing_ok=True)
    return destination


def _materialize_archive(
    item: dict[str, Any],
    output_dir: Path,
    manifest_dir: Path,
) -> Path:
    destination = output_dir / item["filename"]
    if destination.exists():
        verify_file(destination, item["sha256"])
        return destination

    source = (manifest_dir / item["archive"]).resolve()
    if not source.is_file():
        raise FileNotFoundError(f"missing archived FV input: {source}")
    temporary = _atomic_target(destination)
    try:
        shutil.copyfile(source, temporary)
        verify_file(temporary, item["sha256"])
        temporary.replace(destination)
    finally:
        temporary.unlink(missing_ok=True)
    return destination


def prepare_inputs(
    manifest_path: Path = DEFAULT_MANIFEST,
    output_dir: Path = DEFAULT_OUTPUT_DIR,
    *,
    download: Download = _download,
    refresh: bool = False,
) -> list[Path]:
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("schema_version") != 1:
        raise ValueError("unsupported FV input manifest schema")
    output_dir.mkdir(parents=True, exist_ok=True)

    prepared = []
    for item in manifest["files"]:
        if item.get("archive") and not refresh:
            prepared.append(
                _materialize_archive(item, output_dir, manifest_path.parent)
            )
        else:
            prepared.append(
                _materialize_download(
                    item,
                    output_dir,
                    download=download,
                    refresh=refresh,
                )
            )
    for item in manifest["epm_snapshots"]:
        destination = output_dir / f"epm_{item['season_year']}.csv"
        if destination.exists() and not refresh:
            verify_file(destination, item["sha256"])
            prepared.append(destination)
            continue
        if item.get("archive") and not refresh:
            archive_item = {**item, "filename": destination.name}
            prepared.append(
                _materialize_archive(archive_item, output_dir, manifest_path.parent)
            )
            continue

        temporary = _atomic_target(destination)
        try:
            rows = fetch_season_snapshot(item["season_year"])
            write_snapshot(rows, temporary)
            verify_file(temporary, item["sha256"])
            temporary.replace(destination)
        finally:
            temporary.unlink(missing_ok=True)
        prepared.append(destination)
    return prepared


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument(
        "--refresh",
        action="store_true",
        help="redownload even when a verified local input already exists",
    )
    args = parser.parse_args(argv)

    prepared = prepare_inputs(args.manifest, args.output_dir, refresh=args.refresh)
    for path in prepared:
        print(f"verified {path.relative_to(ROOT) if path.is_relative_to(ROOT) else path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
