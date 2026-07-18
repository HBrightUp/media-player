#!/usr/bin/env python3
"""Generate karaoke timelines for lossless songs under the current user's Music directory."""

from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path


AUDIO_EXTENSIONS = {".aac", ".aif", ".aiff", ".flac", ".m4a", ".mp3", ".ogg", ".wav"}
LYRICS_EXTENSIONS = {".lrc", ".txt"}
TIMESTAMP_RE = re.compile(r"\[(\d{1,3}):(\d{2}(?:\.\d{1,3})?)\]")


@dataclass(frozen=True)
class LibraryArea:
    audio_root: Path
    lyrics_root: Path


class AudioChangedError(RuntimeError):
    pass


def parse_args() -> argparse.Namespace:
    music = Path.home() / "Music"
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--music-root", type=Path, default=music)
    parser.add_argument("--work-root", type=Path, default=Path(".cache/karaoke-batch"))
    parser.add_argument("--report", type=Path, default=Path(".cache/karaoke-lossless-report.json"))
    parser.add_argument("--limit", type=int, default=0, help="Process at most this many songs")
    parser.add_argument("--only", default="", help="Process filenames containing this text")
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--keep-work", action="store_true")
    return parser.parse_args()


def find_lyrics(audio: Path, roots: list[Path]) -> Path | None:
    target = audio.stem.casefold()
    for root in roots:
        if not root.is_dir():
            continue
        candidates = sorted(
            path
            for path in root.rglob("*")
            if path.is_file() and path.suffix.casefold() in LYRICS_EXTENSIONS
        )
        exact = [path for path in candidates if path.stem.casefold() == target]
        if exact:
            return exact[0]
        suffix = [path for path in candidates if path.stem.casefold().endswith("-" + target)]
        if suffix:
            return suffix[0]
    return None


def existing_timeline_is_current(path: Path, audio: Path) -> bool:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        stat = audio.stat()
        provenance = payload["audio"]
        coverage = payload["coverage"]
        return (
            payload.get("version") == 1
            and provenance.get("filename") == audio.name
            and provenance.get("size_bytes") == stat.st_size
            and provenance.get("modified_at_ns") == stat.st_mtime_ns
            and coverage.get("aligned_lines", 0) > 0
            and coverage.get("aligned_lines") == coverage.get("sung_lines")
        )
    except (OSError, ValueError, KeyError, TypeError):
        return False


def probe_duration(audio: Path) -> float | None:
    command = [
        "ffprobe",
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        str(audio),
    ]
    result = subprocess.run(command, text=True, capture_output=True)
    if result.returncode != 0:
        return None
    try:
        return float(result.stdout.strip())
    except ValueError:
        return None


def last_lyric_timestamp(lyrics: Path) -> float:
    text = lyrics.read_text(encoding="utf-8-sig", errors="replace")
    values = [int(match.group(1)) * 60 + float(match.group(2)) for match in TIMESTAMP_RE.finditer(text)]
    return max(values, default=0.0)


def readiness_reason(audio: Path, lyrics: Path) -> str | None:
    age_seconds = time.time() - audio.stat().st_mtime
    if age_seconds < 180:
        return f"audio was modified {age_seconds:.0f}s ago; waiting for copy to finish"
    duration = probe_duration(audio)
    if duration is None or duration <= 0:
        return "ffprobe cannot read a complete duration"
    last_timestamp = last_lyric_timestamp(lyrics)
    if last_timestamp > duration + 1.0:
        return f"audio is {duration:.1f}s but lyrics reach {last_timestamp:.1f}s"
    return None


def command_error(command: list[str], result: subprocess.CompletedProcess[str]) -> RuntimeError:
    output = "\n".join(part.strip() for part in (result.stdout, result.stderr) if part.strip())
    tail = "\n".join(output.splitlines()[-24:])
    return RuntimeError(f"command failed ({result.returncode}): {' '.join(command)}\n{tail}")


def write_report(path: Path, report: dict[str, object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def run_song(
    audio: Path,
    lyrics: Path,
    output: Path,
    work_root: Path,
    keep_work: bool,
) -> dict[str, object]:
    demucs = Path(sys.executable).with_name("demucs-mlx")
    generator = Path(__file__).with_name("generate_karaoke_timeline.py")
    work_root.mkdir(parents=True, exist_ok=True)
    temporary = Path(tempfile.mkdtemp(prefix="song-", dir=work_root))
    initial_stat = audio.stat()
    try:
        separation = [
            str(demucs),
            "-o",
            str(temporary),
            "--seed",
            "0",
            "--prefetch-tracks",
            "0",
            "--write-workers",
            "1",
            "--batch-size",
            "1",
            str(audio),
        ]
        result = subprocess.run(separation, text=True, capture_output=True)
        if result.returncode != 0:
            raise command_error(separation, result)
        current_stat = audio.stat()
        if (current_stat.st_size, current_stat.st_mtime_ns) != (initial_stat.st_size, initial_stat.st_mtime_ns):
            raise AudioChangedError("audio changed during vocal separation; waiting for copy to finish")
        vocals = next(iter(temporary.rglob("vocals.wav")), None)
        if vocals is None:
            raise RuntimeError("Demucs completed without producing vocals.wav")

        alignment = [
            sys.executable,
            str(generator),
            "--audio",
            str(audio),
            "--lyrics",
            str(lyrics),
            "--vocals",
            str(vocals),
            "--output",
            str(output),
            "--mode",
            "hybrid",
        ]
        result = subprocess.run(alignment, text=True, capture_output=True)
        if result.returncode != 0:
            raise command_error(alignment, result)
        payload = json.loads(output.read_text(encoding="utf-8"))
        return payload["coverage"]
    finally:
        if not keep_work:
            shutil.rmtree(temporary, ignore_errors=True)


def main() -> int:
    args = parse_args()
    areas = [LibraryArea(args.music_root / "music", args.music_root / "lyrics")]
    shared = args.music_root / "shared-lyrics"
    jobs: list[tuple[Path, Path, Path]] = []
    missing: list[str] = []
    for area in areas:
        if not area.audio_root.is_dir():
            continue
        for audio in sorted(area.audio_root.rglob("*")):
            if not audio.is_file() or audio.suffix.casefold() not in AUDIO_EXTENSIONS:
                continue
            if args.only and args.only.casefold() not in audio.name.casefold():
                continue
            lyrics = find_lyrics(audio, [area.lyrics_root, shared])
            if lyrics is None:
                missing.append(str(audio))
                continue
            output = lyrics.with_name(lyrics.stem + ".karaoke.json")
            jobs.append((audio, lyrics, output))
    if args.limit > 0:
        jobs = jobs[: args.limit]

    report: dict[str, object] = {
        "music_root": str(args.music_root),
        "total": len(jobs),
        "missing_lyrics": missing,
        "completed": [],
        "skipped": [],
        "deferred": [],
        "failed": [],
    }
    print(f"discovered {len(jobs)} matched songs; {len(missing)} missing lyrics", flush=True)
    for index, (audio, lyrics, output) in enumerate(jobs, start=1):
        label = f"[{index}/{len(jobs)}] {audio.name}"
        if not args.force and existing_timeline_is_current(output, audio):
            print(f"{label}: current, skipped", flush=True)
            report["skipped"].append(str(audio))
            write_report(args.report, report)
            continue
        not_ready = readiness_reason(audio, lyrics)
        if not_ready:
            print(f"{label}: deferred ({not_ready})", flush=True)
            report["deferred"].append({"audio": str(audio), "reason": not_ready})
            write_report(args.report, report)
            continue
        print(f"{label}: separating vocals", flush=True)
        try:
            coverage = run_song(audio, lyrics, output, args.work_root, args.keep_work)
            print(
                f"{label}: wrote {coverage['aligned_lines']} lines / {coverage['aligned_tokens']} tokens",
                flush=True,
            )
            report["completed"].append(
                {"audio": str(audio), "lyrics": str(lyrics), "output": str(output), "coverage": coverage}
            )
        except AudioChangedError as error:
            print(f"{label}: deferred ({error})", flush=True)
            report["deferred"].append({"audio": str(audio), "reason": str(error)})
        except Exception as error:
            print(f"{label}: FAILED: {error}", file=sys.stderr, flush=True)
            report["failed"].append({"audio": str(audio), "error": str(error)})
        write_report(args.report, report)

    completed = len(report["completed"])
    skipped = len(report["skipped"])
    deferred = len(report["deferred"])
    failed = len(report["failed"])
    write_report(args.report, report)
    print(f"finished: {completed} generated, {skipped} current, {deferred} deferred, {failed} failed", flush=True)
    return 1 if failed or missing or deferred else 0


if __name__ == "__main__":
    raise SystemExit(main())
