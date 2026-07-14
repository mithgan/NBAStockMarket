from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pytest

from scripts.prepare_fv_inputs import DEFAULT_MANIFEST, prepare_inputs, verify_file


def _digest(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def test_prepare_downloads_and_reuses_verified_static_inputs(tmp_path: Path) -> None:
    content = b"player,value\nTest Player,1\n"
    manifest = tmp_path / "manifest.json"
    manifest.write_text(
        json.dumps(
            {
                "schema_version": 1,
                "files": [
                    {
                        "filename": "input.csv",
                        "url": "https://example.test/input.csv",
                        "sha256": _digest(content),
                    }
                ],
                "epm_snapshots": [],
            }
        ),
        encoding="utf-8",
    )
    calls: list[str] = []

    def download(url: str, destination: Path) -> None:
        calls.append(url)
        destination.write_bytes(content)

    output = tmp_path / "raw"
    prepare_inputs(manifest, output, download=download)
    prepare_inputs(manifest, output, download=download)

    assert (output / "input.csv").read_bytes() == content
    assert calls == ["https://example.test/input.csv"]


def test_prepare_rejects_provider_drift_without_replacing_good_file(
    tmp_path: Path,
) -> None:
    expected = b"expected"
    manifest = tmp_path / "manifest.json"
    manifest.write_text(
        json.dumps(
            {
                "schema_version": 1,
                "files": [
                    {
                        "filename": "input.csv",
                        "url": "https://example.test/input.csv",
                        "sha256": _digest(expected),
                    }
                ],
                "epm_snapshots": [],
            }
        ),
        encoding="utf-8",
    )
    output = tmp_path / "raw"

    with pytest.raises(ValueError, match="input drift"):
        prepare_inputs(
            manifest,
            output,
            download=lambda _url, destination: destination.write_bytes(b"changed"),
        )

    assert not (output / "input.csv").exists()


def test_prepare_uses_archived_mutable_input_without_network(tmp_path: Path) -> None:
    content = b"player,value\nPinned Player,7\n"
    archive = tmp_path / "archive.csv"
    archive.write_bytes(content)
    manifest = tmp_path / "manifest.json"
    manifest.write_text(
        json.dumps(
            {
                "schema_version": 1,
                "files": [
                    {
                        "filename": "input.csv",
                        "url": "https://example.test/live.csv",
                        "archive": "archive.csv",
                        "sha256": _digest(content),
                    }
                ],
                "epm_snapshots": [],
            }
        ),
        encoding="utf-8",
    )

    output = tmp_path / "raw"
    prepare_inputs(
        manifest,
        output,
        download=lambda *_args: (_ for _ in ()).throw(AssertionError("network used")),
    )

    assert (output / "input.csv").read_bytes() == content


def test_real_manifest_materializes_all_inputs_without_network(tmp_path: Path) -> None:
    output = tmp_path / "raw"

    prepared = prepare_inputs(
        DEFAULT_MANIFEST,
        output,
        download=lambda *_args: (_ for _ in ()).throw(AssertionError("network used")),
    )

    assert [path.name for path in prepared] == [
        "lebron.csv",
        "salary.csv",
        "darko_current.csv",
        "epm_2022.csv",
        "epm_2023.csv",
        "epm_2024.csv",
        "epm_2025.csv",
        "epm_2026.csv",
    ]
    assert all(path.is_file() for path in prepared)


def test_refresh_checks_live_source_instead_of_archive(tmp_path: Path) -> None:
    archived = b"pinned"
    live = b"changed"
    (tmp_path / "archive.csv").write_bytes(archived)
    manifest = tmp_path / "manifest.json"
    manifest.write_text(
        json.dumps(
            {
                "schema_version": 1,
                "files": [
                    {
                        "filename": "input.csv",
                        "url": "https://example.test/live.csv",
                        "archive": "archive.csv",
                        "sha256": _digest(archived),
                    }
                ],
                "epm_snapshots": [],
            }
        ),
        encoding="utf-8",
    )

    with pytest.raises(ValueError, match="input drift"):
        prepare_inputs(
            manifest,
            tmp_path / "raw",
            refresh=True,
            download=lambda _url, destination: destination.write_bytes(live),
        )


def test_verify_file_rejects_corrupt_cached_input(tmp_path: Path) -> None:
    path = tmp_path / "cached.csv"
    path.write_bytes(b"corrupt")

    with pytest.raises(ValueError, match="input drift"):
        verify_file(path, _digest(b"expected"))
