#!/usr/bin/env python3
"""Generate a validated, non-destructive karaoke timeline beside an LRC file."""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import unicodedata
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from mlx_qwen3_asr import ForcedAligner
from mlx_qwen3_asr.audio import SAMPLE_RATE, load_audio_np
from mlx_qwen3_asr.forced_aligner import ForcedAlignTextProcessor


TIMESTAMP_RE = re.compile(r"\[(\d{1,3}):(\d{2}(?:\.\d{1,3})?)\]")
METADATA_RE = re.compile(
    r"^(?:"
    r"(?:作?词|作?曲|编曲|编配|改编|编写|演唱|演奏|歌手|制作人|制作统筹|监制|混音|母带|录音|配唱|人声编辑|音频编辑|[和合]声(?:编写|编排|编配|设计)?|和音|伴唱|吉他|贝斯|鼓|键盘|乐队|小提琴(?:编写)?|音乐总监|项目总监|总监|弦乐(?:监制|编写|编曲)?|古筝(?:编写)?|箫|笛|长笛|二胡|琵琶|出品(?:方|人|公司|发行公司)?|发行(?:公司)?|制作公司|音乐出品发行公司|厂牌|(?:首席)?运营|企划|策划|总策划|统筹|商务|宣传|推广|营销|文案|后期|封面|设计|节目(?:名)?|来源|鸣谢)\s*[:：]"
    r"|(?:lyrics?|composed|written|produced|producer|arrangement|arranged|mix(?:ed|ing)?|master(?:ed|ing)?|vocal|bass|guitar|rap|marketing|promotion|copywriting)\s+by\b"
    r"|(?:bass|guitar|rap|marketing|promotion|copywriting)\s*[:：]"
    r"|(?:op\s*/\s*sp|op|sp)\s*[:：]"
    r")",
    re.IGNORECASE,
)
CREDIT_LABEL_HINTS = (
    "作词",
    "词",
    "作曲",
    "曲",
    "编曲",
    "编配",
    "制作",
    "制作人",
    "制作统筹",
    "制作公司",
    "监制",
    "混音",
    "母带",
    "录音",
    "演奏",
    "配唱",
    "人声编辑",
    "音频编辑",
    "和声",
    "合声",
    "和音",
    "伴唱",
    "吉他",
    "贝斯",
    "鼓",
    "键盘",
    "乐队",
    "小提琴",
    "音乐总监",
    "项目总监",
    "总监",
    "弦乐",
    "古筝",
    "箫",
    "笛",
    "长笛",
    "二胡",
    "琵琶",
    "出品",
    "出品人",
    "出品公司",
    "出品发行公司",
    "发行",
    "发行公司",
    "音乐出品发行公司",
    "厂牌",
    "运营",
    "企划",
    "策划",
    "统筹",
    "商务",
    "宣传",
    "推广",
    "营销",
    "文案",
    "后期",
    "封面",
    "设计",
    "节目",
    "节目名",
    "来源",
    "鸣谢",
)
CREDIT_LABEL_RE = re.compile(r"^([^:：]{1,48})[:：]")
KARAOKE_TARGET_FIRST_WORD_OFFSET = 0.04
KARAOKE_LATE_LINE_TOLERANCE = 0.14
KARAOKE_MIN_TOKEN_SECONDS = 0.045
KARAOKE_LAST_TOKEN_SECONDS = 0.18
KARAOKE_CJK_TOKEN_TARGET_SECONDS = 0.42
KARAOKE_LATIN_TOKEN_TARGET_SECONDS = 0.68
KARAOKE_LINE_TAIL_SECONDS = 1.05
KARAOKE_CJK_REBALANCE_MIN_TOKENS = 5
KARAOKE_CJK_MAX_TOKEN_SECONDS = 1.35
KARAOKE_CJK_TINY_TOKEN_RATIO = 0.26
KARAOKE_CJK_LIGHT_TOKENS = frozenset({"的", "了", "着", "过", "吗", "吧", "呢", "啊", "呀", "啦", "么"})
KARAOKE_CJK_SHORT_TOKENS = frozenset({"不", "一"})


@dataclass(frozen=True)
class LRCLine:
    time_seconds: float
    text: str
    source_index: int


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--audio", type=Path, required=True, help="Original audio file, used for provenance")
    parser.add_argument("--lyrics", type=Path, required=True, help="Source LRC file")
    parser.add_argument("--vocals", type=Path, required=True, help="Separated vocals WAV/audio file")
    parser.add_argument("--output", type=Path, required=True, help="Destination .karaoke.json")
    parser.add_argument("--language", default="auto", help="Aligner language; auto handles Chinese/English lyrics")
    parser.add_argument("--mode", choices=("hybrid", "full", "line"), default="hybrid")
    return parser.parse_args()


def parse_lrc(path: Path) -> list[LRCLine]:
    text = path.read_text(encoding="utf-8-sig", errors="replace").replace("\r\n", "\n")
    result: list[LRCLine] = []
    for source_index, raw_line in enumerate(text.splitlines()):
        matches = list(TIMESTAMP_RE.finditer(raw_line))
        lyric = TIMESTAMP_RE.sub("", raw_line).strip()
        if not matches or not lyric:
            continue
        for match in matches:
            minutes = int(match.group(1))
            seconds = float(match.group(2))
            result.append(LRCLine(minutes * 60 + seconds, lyric, source_index))
    result.sort(key=lambda line: (line.time_seconds, line.source_index))
    return result


def is_kept_char(char: str) -> bool:
    return char == "'" or unicodedata.category(char)[:1] in {"L", "N"}


def is_cjk(char: str) -> bool:
    return ForcedAlignTextProcessor.is_cjk_char(char)


def is_metadata(line: LRCLine) -> bool:
    text = line.text.strip()
    if METADATA_RE.match(text):
        return True
    label_match = CREDIT_LABEL_RE.match(text)
    if label_match:
        label = re.sub(r"[\sA-Za-z0-9()（）/._-]+", "", label_match.group(1))
        if any(hint in label for hint in CREDIT_LABEL_HINTS):
            return True
    lowered = text.casefold()
    if lowered.startswith(("lrc by", "offset:", "re:", "ve:", "ti:", "ar:", "al:", "by:")):
        return True
    if (
        "未经著作权人" in text
        or "不得以任何方式" in text
        or "著作权权利保留" in text
        or "未经许可" in text
    ):
        return True
    if text.endswith(("：", ":")) and len(text) <= 32:
        return True
    if line.time_seconds < 5 and len(text) <= 60 and ("《" in text or "》" in text):
        return True
    if line.time_seconds < 12 and (" - " in text or ("-" in text and len(text) <= 40)):
        return True
    return not any(is_kept_char(char) for char in text)


def choose_sung_lines(lines: list[LRCLine]) -> list[LRCLine]:
    candidates = [line for line in lines if not is_metadata(line)]
    if not candidates:
        return []

    # Bilingual LRC files commonly place a translation and the sung line at the
    # same timestamp. Prefer the Latin line for clearly Chinese/English pairs.
    by_time: dict[float, list[LRCLine]] = {}
    for line in candidates:
        by_time.setdefault(line.time_seconds, []).append(line)

    selected: list[LRCLine] = []
    for group in by_time.values():
        has_latin = any(sum(char.isascii() and char.isalpha() for char in item.text) >= 3 for item in group)
        has_cjk = any(sum(is_cjk(char) for char in item.text) >= 2 for item in group)
        if len(group) > 1 and has_latin and has_cjk:
            latin = [item for item in group if sum(char.isascii() and char.isalpha() for char in item.text) >= 3]
            selected.extend(latin[:1])
        else:
            selected.append(group[0])
    selected.sort(key=lambda line: (line.time_seconds, line.source_index))
    return selected


def infer_language(lines: list[LRCLine], requested: str) -> str:
    if requested.strip().casefold() != "auto":
        return requested
    japanese_count = sum(
        "\u3040" <= char <= "\u30ff" for line in lines for char in line.text
    )
    korean_count = sum(
        "\uac00" <= char <= "\ud7af" for line in lines for char in line.text
    )
    if japanese_count >= 5:
        return "Japanese"
    if korean_count >= 5:
        return "Korean"
    cjk_count = sum(is_cjk(char) for line in lines for char in line.text)
    latin_count = sum(char.isascii() and char.isalpha() for line in lines for char in line.text)
    return "Chinese" if cjk_count >= latin_count * 0.3 else "English"


def tokens_for_line(line: LRCLine, language: str) -> list[str]:
    return ForcedAlignTextProcessor.tokenize_text(line.text, language)


def display_tokens(raw_text: str, clean_tokens: list[str]) -> list[str]:
    """Restore spaces and punctuation removed by the aligner's tokenizer."""
    if not clean_tokens:
        return []
    ranges: list[str] = []
    cursor = 0
    folded_raw = raw_text.casefold()
    for token in clean_tokens:
        start = cursor
        remaining = token.casefold()
        matched = ""
        while cursor < len(raw_text) and matched != remaining:
            char = folded_raw[cursor]
            cursor += 1
            if is_kept_char(char):
                matched += char
        if matched != remaining:
            return clean_tokens
        ranges.append(raw_text[start:cursor])
    if cursor < len(raw_text):
        ranges[-1] += raw_text[cursor:]
    return ranges


def serialize_line(line: LRCLine, aligned_words: list[object], clean_tokens: list[str], offset: float = 0.0) -> dict[str, object]:
    decorated = display_tokens(line.text, clean_tokens)
    words = []
    for index, aligned in enumerate(aligned_words):
        words.append(
            {
                "text": decorated[index],
                "start_seconds": round(float(aligned.start_time) + offset, 3),
                "end_seconds": round(float(aligned.end_time) + offset, 3),
            }
        )
    return {
        "time_seconds": round(line.time_seconds, 3),
        "text": line.text,
        "words": words,
    }


def median(values: list[float]) -> float:
    ordered = sorted(values)
    middle = len(ordered) // 2
    if len(ordered) % 2 == 1:
        return ordered[middle]
    return (ordered[middle - 1] + ordered[middle]) / 2


def estimate_karaoke_shift(lines: list[LRCLine], results: list[dict[str, object] | None]) -> float:
    offsets: list[float] = []
    for line, result in zip(lines, results, strict=True):
        if result is None:
            continue
        words = result.get("words")
        if not isinstance(words, list) or not words:
            continue
        first = words[0]
        if not isinstance(first, dict):
            continue
        try:
            offset = float(first["start_seconds"]) - line.time_seconds
        except (KeyError, TypeError, ValueError):
            continue
        if -0.75 <= offset <= 1.8:
            offsets.append(offset)
    if len(offsets) < 4:
        return 0.0
    center = median(offsets)
    if center > 0.12:
        return min(0.75, center - KARAOKE_TARGET_FIRST_WORD_OFFSET)
    if center < -0.28:
        return max(-0.35, center + KARAOKE_TARGET_FIRST_WORD_OFFSET)
    return 0.0


def refine_karaoke_timings(lines: list[LRCLine], results: list[dict[str, object] | None], duration: float) -> None:
    song_shift = estimate_karaoke_shift(lines, results)
    for index, result in enumerate(results):
        if result is None:
            continue
        next_time = lines[index + 1].time_seconds if index + 1 < len(lines) else duration
        refine_karaoke_line(lines[index], result, next_time, duration, song_shift)


def refine_karaoke_line(
    line: LRCLine,
    result: dict[str, object],
    next_time: float,
    duration: float,
    song_shift: float,
) -> None:
    words = result.get("words")
    if not isinstance(words, list) or not words:
        return

    typed_words = [word for word in words if isinstance(word, dict)]
    if len(typed_words) != len(words):
        return

    count = len(typed_words)
    line_start = max(0.0, line.time_seconds - 0.22)
    if next_time > line.time_seconds + 0.12:
        line_window_end = min(duration, next_time - 0.035)
    else:
        line_window_end = duration
    minimum_span = max(KARAOKE_LAST_TOKEN_SECONDS, count * KARAOKE_MIN_TOKEN_SECONDS)
    if line_window_end <= line_start + minimum_span:
        line_window_end = min(duration, line_start + minimum_span)
    line_window_end = min(line_window_end, line_start + karaoke_line_span_cap(typed_words))
    if line_window_end <= line_start + minimum_span:
        line_window_end = min(duration, line_start + minimum_span)

    raw_starts: list[float] = []
    raw_ends: list[float] = []
    for word in typed_words:
        raw_starts.append(float(word["start_seconds"]) - song_shift)
        raw_ends.append(float(word["end_seconds"]) - song_shift)

    raw_line_end = max(raw_ends[-1], raw_starts[-1] + KARAOKE_LAST_TOKEN_SECONDS)
    line_end = min(line_window_end, max(raw_line_end, line.time_seconds + minimum_span))
    if line_end <= line_start + minimum_span:
        line_end = min(duration, line_start + minimum_span)

    min_gap = min(KARAOKE_MIN_TOKEN_SECONDS, max(0.018, (line_end - line_start) / max(count * 1.8, 1)))
    starts: list[float] = []
    previous = line_start - min_gap
    for index, raw_start in enumerate(raw_starts):
        latest_start = line_end - (count - index) * min_gap
        latest_start = max(line_start, latest_start)
        start = min(max(raw_start, line_start), latest_start)
        if start < previous + min_gap:
            start = previous + min_gap
        starts.append(round(start, 3))
        previous = start

    latest_first = line.time_seconds + KARAOKE_LATE_LINE_TOLERANCE
    if starts and starts[0] > latest_first:
        delta = starts[0] - latest_first
        adjusted: list[float] = []
        previous = line_start - min_gap
        for index, start in enumerate(starts):
            latest_start = line_end - delta - (count - index) * min_gap
            latest_start = max(line_start, latest_start)
            next_start = min(max(start - delta, line_start), latest_start)
            if next_start < previous + min_gap:
                next_start = previous + min_gap
            adjusted.append(round(next_start, 3))
            previous = next_start
        starts = adjusted
        line_end = max(starts[-1] + KARAOKE_LAST_TOKEN_SECONDS, line_end - delta)

    line_end = min(line_window_end, max(line_end, starts[-1] + KARAOKE_LAST_TOKEN_SECONDS))
    for index, word in enumerate(typed_words):
        start = starts[index]
        if index + 1 < count:
            end = starts[index + 1]
        else:
            end = max(raw_ends[index], start + KARAOKE_LAST_TOKEN_SECONDS)
            end = min(line_window_end, end)
        if end <= start:
            end = min(line_window_end, start + min_gap)
        word["start_seconds"] = round(start, 3)
        word["end_seconds"] = round(max(start, end), 3)
    rebalance_cjk_line_if_needed(typed_words)


def karaoke_line_span_cap(words: list[dict[str, object]]) -> float:
    cjk_count = 0
    latin_count = 0
    kept_count = 0
    for word in words:
        text = str(word.get("text", ""))
        for char in text:
            if is_cjk(char):
                cjk_count += 1
                kept_count += 1
            elif char.isascii() and char.isalpha():
                latin_count += 1
                kept_count += 1
            elif is_kept_char(char):
                kept_count += 1
    token_count = max(1, len(words))
    if cjk_count >= max(2, latin_count):
        span = token_count * KARAOKE_CJK_TOKEN_TARGET_SECONDS + KARAOKE_LINE_TAIL_SECONDS
    else:
        span = token_count * KARAOKE_LATIN_TOKEN_TARGET_SECONDS + KARAOKE_LINE_TAIL_SECONDS
    # Let unusually dense punctuation-free lines breathe a little, but never
    # allow instrumental gaps to become a held final syllable.
    if kept_count > token_count:
        span += min(1.2, (kept_count - token_count) * 0.08)
    return max(2.2, min(8.6, span))


def cjk_character_count(text: str) -> int:
    return sum(1 for char in text if is_cjk(char))


def latin_character_count(text: str) -> int:
    return sum(1 for char in text if char.isascii() and char.isalpha())


def is_cjk_dominant_words(words: list[dict[str, object]]) -> bool:
    cjk_count = sum(cjk_character_count(str(word.get("text", ""))) for word in words)
    latin_count = sum(latin_character_count(str(word.get("text", ""))) for word in words)
    return cjk_count >= KARAOKE_CJK_REBALANCE_MIN_TOKENS and cjk_count >= latin_count * 2


def rebalance_cjk_line_if_needed(words: list[dict[str, object]]) -> None:
    """Smooth pathological CJK per-character timings while keeping the line window.

    Forced alignment is very good at finding the line, but for sung Chinese it
    occasionally puts a long melisma on the wrong character and squeezes the
    actual ending syllables into a few frames. KTV highlighting looks worse when
    that happens than when we use a smooth syllable-paced sweep for the line.
    """
    count = len(words)
    if count < KARAOKE_CJK_REBALANCE_MIN_TOKENS or not is_cjk_dominant_words(words):
        return
    try:
        line_start = float(words[0]["start_seconds"])
        line_end = float(words[-1]["end_seconds"])
        durations = [float(word["end_seconds"]) - float(word["start_seconds"]) for word in words]
    except (KeyError, TypeError, ValueError):
        return
    total = line_end - line_start
    if total <= count * KARAOKE_MIN_TOKEN_SECONDS:
        return

    average = total / count
    median_duration = median(durations)
    max_allowed = max(KARAOKE_CJK_MAX_TOKEN_SECONDS, average * 2.35)
    tiny_allowed = max(KARAOKE_MIN_TOKEN_SECONDS * 1.4, average * KARAOKE_CJK_TINY_TOKEN_RATIO)
    longest_is_outlier = max(durations) > max(max_allowed, median_duration * 3.0)
    tail_is_squeezed = any(duration < tiny_allowed for duration in durations[-3:])
    if not longest_is_outlier and not tail_is_squeezed:
        return

    weights = [cjk_token_weight(str(word.get("text", "")), index, count) for index, word in enumerate(words)]
    min_duration = min(0.18, max(KARAOKE_MIN_TOKEN_SECONDS, average * 0.34))
    max_duration = max(min_duration * 1.6, min(max_allowed, average * 1.85))
    balanced = bounded_weighted_durations(total, weights, min_duration, max_duration)

    cursor = line_start
    for index, word in enumerate(words):
        start = cursor
        end = line_end if index + 1 == count else cursor + balanced[index]
        word["start_seconds"] = round(start, 3)
        word["end_seconds"] = round(max(start + KARAOKE_MIN_TOKEN_SECONDS, end), 3)
        cursor = end


def cjk_token_weight(text: str, index: int, count: int) -> float:
    cjk_text = "".join(char for char in text if is_cjk(char))
    if cjk_text:
        weight = float(max(1, len(cjk_text)))
        if cjk_text in KARAOKE_CJK_LIGHT_TOKENS:
            weight *= 0.68
        elif cjk_text in KARAOKE_CJK_SHORT_TOKENS:
            weight *= 0.82
    else:
        kept = sum(1 for char in text if is_kept_char(char))
        weight = float(max(1, kept)) * 0.75
    if index + 1 == count:
        weight *= 1.18
    return max(0.45, weight)


def bounded_weighted_durations(
    total: float,
    weights: list[float],
    min_duration: float,
    max_duration: float,
) -> list[float]:
    count = len(weights)
    if count == 0:
        return []
    if total <= 0:
        return [0.0] * count
    if min_duration * count > total:
        min_duration = total / count * 0.75
    if max_duration * count < total:
        max_duration = total / count * 1.25

    durations: list[float | None] = [None] * count
    open_indices = set(range(count))
    remaining_total = total
    remaining_weight = sum(weights)
    while open_indices and remaining_weight > 0:
        changed = False
        for index in list(open_indices):
            value = remaining_total * weights[index] / remaining_weight
            if value < min_duration:
                durations[index] = min_duration
                remaining_total -= min_duration
                remaining_weight -= weights[index]
                open_indices.remove(index)
                changed = True
            elif value > max_duration:
                durations[index] = max_duration
                remaining_total -= max_duration
                remaining_weight -= weights[index]
                open_indices.remove(index)
                changed = True
        if not changed:
            break
    for index in open_indices:
        durations[index] = remaining_total * weights[index] / remaining_weight if remaining_weight > 0 else total / count
    return [float(value) for value in durations]


def line_is_plausible(
    line: LRCLine,
    result: dict[str, object],
    next_time: float,
    duration: float,
    *,
    relaxed: bool = False,
) -> bool:
    words = result.get("words")
    if not isinstance(words, list) or not words:
        return False
    first = float(words[0]["start_seconds"])
    last = float(words[-1]["end_seconds"])
    if relaxed:
        latest_start = min(line.time_seconds + 2.0, next_time + 0.5)
        upper = min(duration, next_time + 2.0)
    else:
        latest_start = min(line.time_seconds + 1.25, next_time - 0.08)
        upper = min(duration, next_time + 0.85)
    return line.time_seconds - 0.65 <= first <= latest_start and first <= last <= upper


def align_full_song(
    aligner: ForcedAligner,
    audio: np.ndarray,
    lines: list[LRCLine],
    tokens: list[list[str]],
    language: str,
) -> list[dict[str, object]]:
    transcript = "\n".join(line.text for line in lines)
    aligned = aligner.align(audio, transcript, language)
    expected = sum(len(value) for value in tokens)
    if len(aligned) != expected:
        raise RuntimeError(f"full-song token count mismatch: got {len(aligned)}, expected {expected}")

    result: list[dict[str, object]] = []
    cursor = 0
    for line, line_tokens in zip(lines, tokens, strict=True):
        end = cursor + len(line_tokens)
        result.append(serialize_line(line, aligned[cursor:end], line_tokens))
        cursor = end
    return result


def align_one_line(
    aligner: ForcedAligner,
    audio: np.ndarray,
    line: LRCLine,
    clean_tokens: list[str],
    language: str,
    next_time: float,
) -> dict[str, object]:
    # Keep the excerpt tight: a wider leading context often causes a forced
    # aligner to assign the new text to the tail of the preceding sung line.
    segment_start = max(0.0, line.time_seconds - 0.55)
    segment_end = min(len(audio) / SAMPLE_RATE, max(line.time_seconds + 2.0, next_time + 0.65))
    segment_end = min(segment_end, segment_start + 24.0)
    segment = audio[int(segment_start * SAMPLE_RATE) : int(segment_end * SAMPLE_RATE)]
    aligned = aligner.align(segment, line.text, language)
    if len(aligned) != len(clean_tokens):
        raise RuntimeError(
            f"line token count mismatch at {line.time_seconds:.2f}s: got {len(aligned)}, expected {len(clean_tokens)}"
        )
    result = serialize_line(line, aligned, clean_tokens, segment_start)
    # Timestamp heads occasionally predict a few frames outside a short crop.
    # Clamp those frames to the audio excerpt instead of rejecting the song.
    for word in result["words"]:
        start = min(segment_end, max(segment_start, float(word["start_seconds"])))
        end = min(segment_end, max(start, float(word["end_seconds"])))
        word["start_seconds"] = round(start, 3)
        word["end_seconds"] = round(end, 3)
    return result


def generate(args: argparse.Namespace) -> dict[str, object]:
    parsed = parse_lrc(args.lyrics)
    lines = choose_sung_lines(parsed)
    if not lines:
        raise RuntimeError("no sung lyric lines found")
    language = infer_language(lines, args.language)
    tokens = [tokens_for_line(line, language) for line in lines]
    filtered = [(line, value) for line, value in zip(lines, tokens, strict=True) if value]
    lines = [item[0] for item in filtered]
    tokens = [item[1] for item in filtered]
    if not lines:
        raise RuntimeError("no alignable lyric tokens found")

    print(f"loading vocals: {args.vocals}", flush=True)
    audio = load_audio_np(str(args.vocals), sr=SAMPLE_RATE)
    duration = len(audio) / SAMPLE_RATE
    aligner = ForcedAligner()
    results: list[dict[str, object] | None] = [None] * len(lines)

    if args.mode in {"hybrid", "full"}:
        print(f"aligning full song ({duration:.1f}s, {sum(map(len, tokens))} tokens)", flush=True)
        try:
            full_results = align_full_song(aligner, audio, lines, tokens, language)
            for index, result in enumerate(full_results):
                next_time = lines[index + 1].time_seconds if index + 1 < len(lines) else duration
                if line_is_plausible(lines[index], result, next_time, duration):
                    results[index] = result
        except Exception as error:
            if args.mode == "full":
                raise
            print(f"full-song alignment unavailable: {error}", file=sys.stderr, flush=True)

    missing = [index for index, result in enumerate(results) if result is None]
    if args.mode == "full" and missing:
        raise RuntimeError(f"full-song validation rejected {len(missing)} of {len(lines)} lines")
    for progress, index in enumerate(missing, start=1):
        next_time = lines[index + 1].time_seconds if index + 1 < len(lines) else duration
        print(f"realigning line {progress}/{len(missing)} at {lines[index].time_seconds:.2f}s", flush=True)
        result = align_one_line(aligner, audio, lines[index], tokens[index], language, next_time)
        if not line_is_plausible(lines[index], result, next_time, duration, relaxed=True):
            print(
                f"warning: accepted bounded fallback alignment at {lines[index].time_seconds:.2f}s: {lines[index].text}",
                file=sys.stderr,
                flush=True,
            )
        results[index] = result

    refine_karaoke_timings(lines, results, duration)
    completed = [result for result in results if result is not None]
    stat = args.audio.stat()
    return {
        "version": 1,
        "audio": {
            "filename": args.audio.name,
            "size_bytes": stat.st_size,
            "modified_at_ns": stat.st_mtime_ns,
            "duration_seconds": round(duration, 3),
        },
        "generator": {
            "model": "Qwen/Qwen3-ForcedAligner-0.6B",
            "input": "demucs-mlx vocals stem",
            "language": language,
        },
        "coverage": {
            "lrc_lines": len(parsed),
            "sung_lines": len(lines),
            "aligned_lines": len(completed),
            "aligned_tokens": sum(len(result["words"]) for result in completed),
        },
        "lines": completed,
    }


def main() -> int:
    args = parse_args()
    for path in (args.audio, args.lyrics, args.vocals):
        if not path.is_file():
            raise FileNotFoundError(path)
    payload = generate(args)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    temporary = args.output.with_suffix(args.output.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(temporary, args.output)
    coverage = payload["coverage"]
    print(
        f"wrote {args.output}: {coverage['aligned_lines']} lines, {coverage['aligned_tokens']} tokens",
        flush=True,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
