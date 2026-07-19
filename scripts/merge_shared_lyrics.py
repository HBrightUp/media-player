#!/usr/bin/env python3
"""Merge configured lossless/lossy lyric files into the shared lyrics directory.

The backend already scans area-specific lyrics first and the shared directory as
fallback. To make the shared lyrics the effective single source, this tool copies
the selected lyrics into the configured shared directory and moves merged
area-specific lyric files into a timestamped backup directory.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import sys
import time
from dataclasses import dataclass
from pathlib import Path


SUPPORTED_LYRIC_SUFFIXES = (".lrc", ".txt", ".karaoke.json")
SOURCE_PRIORITY = {"lossless": 30, "lossy": 20, "shared": 10}


@dataclass(frozen=True)
class LyricFile:
    source: str
    root: Path
    path: Path
    base_key: str
    suffix: str
    sha256: str
    size: int

    @property
    def shared_name(self) -> str:
        return self.path.name


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, default=Path("config.yaml"))
    parser.add_argument("--dry-run", action="store_true", help="Only print a merge plan")
    parser.add_argument("--report", type=Path, default=Path(".cache/merge-shared-lyrics-report.json"))
    parser.add_argument(
        "--backup-root",
        type=Path,
        default=None,
        help="Directory used for moved area-specific lyrics; defaults beside shared lyrics",
    )
    return parser.parse_args()


def strip_comment(line: str) -> str:
    in_single = False
    in_double = False
    for index, char in enumerate(line):
        if char == "'" and not in_double:
            in_single = not in_single
        elif char == '"' and not in_single:
            in_double = not in_double
        elif char == "#" and not in_single and not in_double:
            return line[:index]
    return line


def clean_value(value: str) -> str:
    value = value.strip().strip("\"'")
    return os.path.expandvars(value)


def parse_simple_yaml(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    sections: list[tuple[int, str]] = []
    for raw in path.read_text(encoding="utf-8").splitlines():
        line_without_comment = strip_comment(raw)
        line = line_without_comment.strip()
        if not line or ":" not in line:
            continue
        key, value = line.split(":", 1)
        key = key.strip().lower().replace("-", "_")
        value = clean_value(value)
        indent = len(line_without_comment) - len(line_without_comment.lstrip(" \t"))
        while sections and indent <= sections[-1][0]:
            sections.pop()
        full_key = ".".join([part for _, part in sections] + [key])
        if value:
            values[full_key] = value
        else:
            sections.append((indent, key))
    return values


def configured_paths(config_path: Path) -> dict[str, Path]:
    values = parse_simple_yaml(config_path)

    def get(*keys: str) -> Path | None:
        for key in keys:
            value = values.get(key)
            if value:
                return Path(value).expanduser().resolve()
        return None

    return {
        "lossless_lyrics": get("library.lossless.lyrics_directory", "lossless_lyrics_directory", "library.lossless_lyrics_directory"),
        "lossy_lyrics": get("library.lossy.lyrics_directory", "lossy_lyrics_directory", "library.lossy_lyrics_directory"),
        "shared_lyrics": get("library.shared_lyrics_directory", "shared_lyrics_directory", "library.common_lyrics_directory"),
    }


def lyric_suffix(path: Path) -> str | None:
    name = path.name.casefold()
    if name.endswith(".karaoke.json"):
        return ".karaoke.json"
    suffix = path.suffix.casefold()
    if suffix in {".lrc", ".txt"}:
        return suffix
    return None


def lyric_base_key(path: Path) -> str:
    name = path.name
    if name.casefold().endswith(".karaoke.json"):
        base = name[: -len(".karaoke.json")]
    else:
        base = path.stem
    return " ".join(base.casefold().split())


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def scan_lyrics(source: str, root: Path | None) -> list[LyricFile]:
    if root is None or not root.is_dir():
        return []
    result: list[LyricFile] = []
    for path in sorted(root.rglob("*")):
        if not path.is_file():
            continue
        suffix = lyric_suffix(path)
        if suffix is None:
            continue
        stat = path.stat()
        result.append(
            LyricFile(
                source=source,
                root=root,
                path=path,
                base_key=lyric_base_key(path),
                suffix=suffix,
                sha256=sha256_file(path),
                size=stat.st_size,
            )
        )
    return result


def source_score(file: LyricFile, all_files: list[LyricFile]) -> tuple[int, int, int, int, str]:
    same_base_sources = {
        candidate.source
        for candidate in all_files
        if candidate.base_key == file.base_key and candidate.suffix == ".karaoke.json"
    }
    has_karaoke_pair = 1 if file.source in same_base_sources else 0
    lossless_has_karaoke = 1 if "lossless" in same_base_sources else 0
    return (
        has_karaoke_pair,
        lossless_has_karaoke,
        SOURCE_PRIORITY.get(file.source, 0),
        file.size,
        file.path.name,
    )


def choose_files(files: list[LyricFile]) -> tuple[dict[tuple[str, str], LyricFile], list[dict[str, object]]]:
    grouped: dict[tuple[str, str], list[LyricFile]] = {}
    for file in files:
        grouped.setdefault((file.base_key, file.suffix), []).append(file)

    selected: dict[tuple[str, str], LyricFile] = {}
    conflicts: list[dict[str, object]] = []
    for key, candidates in grouped.items():
        winner = sorted(candidates, key=lambda item: source_score(item, files), reverse=True)[0]
        selected[key] = winner
        distinct_hashes = sorted({candidate.sha256 for candidate in candidates})
        if len(distinct_hashes) > 1:
            conflicts.append(
                {
                    "base": key[0],
                    "suffix": key[1],
                    "selected": str(winner.path),
                    "candidates": [
                        {
                            "source": candidate.source,
                            "path": str(candidate.path),
                            "sha256": candidate.sha256,
                            "size": candidate.size,
                        }
                        for candidate in candidates
                    ],
                }
            )
    return selected, conflicts


def relative_backup_path(file: LyricFile) -> Path:
    try:
        relative = file.path.relative_to(file.root)
    except ValueError:
        relative = Path(file.path.name)
    return Path(file.source) / relative


def copy_if_needed(source: Path, target: Path) -> str:
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists():
        if sha256_file(target) == sha256_file(source):
            return "unchanged"
        raise FileExistsError(f"target already exists with different content: {target}")
    shutil.copy2(source, target)
    return "copied"


def move_to_backup(source: Path, backup: Path) -> str:
    backup.parent.mkdir(parents=True, exist_ok=True)
    if not source.exists():
        return "missing"
    if backup.exists():
        if sha256_file(source) == sha256_file(backup):
            source.unlink()
            return "removed_duplicate"
        raise FileExistsError(f"backup already exists with different content: {backup}")
    shutil.move(str(source), str(backup))
    return "moved"


def write_report(path: Path, payload: dict[str, object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> int:
    args = parse_args()
    config_path = args.config.resolve()
    paths = configured_paths(config_path)
    shared_root = paths.get("shared_lyrics")
    if shared_root is None:
        print("config does not define library.shared_lyrics_directory", file=sys.stderr)
        return 2

    files = [
        *scan_lyrics("lossless", paths.get("lossless_lyrics")),
        *scan_lyrics("lossy", paths.get("lossy_lyrics")),
        *scan_lyrics("shared", shared_root),
    ]
    selected, conflicts = choose_files(files)
    timestamp = time.strftime("%Y%m%d%H%M%S")
    backup_root = (args.backup_root or shared_root.parent / f"lyrics-merged-backup-{timestamp}").resolve()

    shared_actions: list[dict[str, object]] = []
    backup_actions: list[dict[str, object]] = []

    for file in selected.values():
        target = shared_root / file.shared_name
        action = "would_copy"
        if file.source == "shared" and file.path.resolve() == target.resolve():
            action = "already_shared"
        elif not args.dry_run:
            action = copy_if_needed(file.path, target)
        shared_actions.append({"action": action, "source": str(file.path), "target": str(target)})

    for file in files:
        if file.source == "shared":
            continue
        backup = backup_root / relative_backup_path(file)
        action = "would_move"
        if not args.dry_run:
            action = move_to_backup(file.path, backup)
        backup_actions.append({"action": action, "source": str(file.path), "backup": str(backup)})

    report = {
        "config": str(config_path),
        "paths": {key: str(value) if value else "" for key, value in paths.items()},
        "dry_run": args.dry_run,
        "total_source_files": len(files),
        "shared_targets": len(selected),
        "conflicts": conflicts,
        "backup_root": str(backup_root),
        "shared_actions": shared_actions,
        "backup_actions": backup_actions,
    }
    write_report(args.report, report)

    copied = sum(1 for item in shared_actions if item["action"] in {"copied", "would_copy"})
    moved = sum(1 for item in backup_actions if item["action"] in {"moved", "would_move", "removed_duplicate"})
    print(f"config: {config_path}")
    print(f"shared lyrics: {shared_root}")
    print(f"source lyric files: {len(files)}")
    print(f"shared targets: {len(selected)}")
    print(f"conflicts needing review: {len(conflicts)}")
    print(f"copy actions: {copied}")
    print(f"backup/move actions: {moved}")
    print(f"backup root: {backup_root}")
    print(f"report: {args.report}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
