from __future__ import annotations

import re
from datetime import datetime, timezone
from difflib import SequenceMatcher
from typing import Any

import textstat

from seo_engine.engine.internal_links import body_has_internal_link_signal
from seo_engine.engine.state import ClientConfig, ContentBrief, GeneratedPost, GateResult


class GateFailException(Exception):
    """Raised when the quality gate returns FAIL."""

    def __init__(self, gate_result: GateResult) -> None:
        self.gate_result = gate_result
        super().__init__(f"Quality gate FAIL: {gate_result.hard_failures}")


def similarity_ratio(a: str, b: str) -> float:
    a, b = a.strip().lower(), b.strip().lower()
    if not a or not b:
        return 0.0
    return SequenceMatcher(None, a, b).ratio()


def count_h2_atx(body: str) -> int:
    """Count ATX-style ## headers (H2), not ###."""
    lines = body.splitlines()
    n = 0
    for line in lines:
        if re.match(r"^##\s+[^#]", line):
            n += 1
    return n


def word_count_body(body: str) -> int:
    text = re.sub(r"```[\s\S]*?```", " ", body)
    text = re.sub(r"\[LINK:\s*[^\]]+\]", " ", text)
    # Markdown links: count anchor text only (not URL tokens)
    text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)
    words = re.findall(r"[A-Za-z0-9']+", text)
    return len(words)


def opening_text(body: str, max_words: int = 150) -> str:
    text = body.strip()
    words = re.findall(r"\S+", text)
    return " ".join(words[:max_words])


def primary_keyword_in_text(keyword: str, text: str) -> bool:
    if not keyword or not text:
        return False
    return keyword.strip().lower() in text.lower()


def keyword_density(body: str, keyword: str) -> float:
    if not keyword.strip():
        return 0.0
    wc = word_count_body(body)
    if wc == 0:
        return 0.0
    pattern = re.compile(re.escape(keyword.strip()), re.IGNORECASE)
    matches = len(pattern.findall(body))
    return (matches / wc) * 100.0


def run_gate(
    post: GeneratedPost,
    brief: ContentBrief,
    config: ClientConfig,
    published_titles_slugs: list[tuple[str, str]],
) -> GateResult:
    """Deterministic quality gate. Returns GateResult with PASS or FAIL."""
    hard: list[str] = []
    warnings: list[str] = []

    min_w = config.min_word_count
    max_w = config.max_word_count
    wc = word_count_body(post.body_markdown)
    if wc < min_w:
        hard.append(f"minimum_word_count (got {wc}, need >= {min_w})")
    if wc > max_w:
        hard.append(f"maximum_word_count (got {wc}, need <= {max_w})")

    if not post.meta_description or not str(post.meta_description).strip():
        hard.append("meta_description_missing")
    elif len(post.meta_description) > 160:
        hard.append(f"meta_description_length (got {len(post.meta_description)}, max 160)")

    if not post.title or not str(post.title).strip():
        hard.append("title_missing")

    h2n = count_h2_atx(post.body_markdown)
    if h2n < 2:
        hard.append(f"h2_headers (got {h2n}, need >= 2)")

    kw = brief.target_keyword
    if not primary_keyword_in_text(kw, post.title):
        hard.append("target_keyword_not_in_title")
    opening = opening_text(post.body_markdown, 150)
    if not primary_keyword_in_text(kw, opening):
        hard.append("target_keyword_not_in_opening_150_words")

    for title, slug in published_titles_slugs:
        if similarity_ratio(post.title, title) > 0.85:
            hard.append(f"duplicate_topic_title (>85% similar to published: {title!r})")
            break
        if similarity_ratio(post.slug, slug) > 0.85:
            hard.append(f"duplicate_topic_slug (>85% similar to published: {slug!r})")
            break

    # Schema-ish required fields
    if not post.slug or not str(post.slug).strip():
        hard.append("slug_missing")
    if not post.body_markdown or not str(post.body_markdown).strip():
        hard.append("body_missing")

    dens = keyword_density(post.body_markdown, kw)
    if dens < 0.5:
        warnings.append(f"keyword_density_low ({dens:.2f}%)")
    if dens > 2.5:
        warnings.append(f"keyword_density_high ({dens:.2f}%)")

    if not body_has_internal_link_signal(post.body_markdown, config):
        warnings.append("no_internal_link_placeholders")

    if not _has_conclusion_signal(post.body_markdown):
        warnings.append("no_conclusion_section_signal")

    try:
        fk = textstat.flesch_reading_ease(post.body_markdown)
        if fk < 40:
            warnings.append(f"readability_complex (Flesch {fk:.1f})")
        if fk > 85:
            warnings.append(f"readability_too_simple (Flesch {fk:.1f})")
    except Exception:
        pass

    result = "FAIL" if hard else "PASS"
    checked_at = datetime.now(timezone.utc)
    gate_log: dict[str, Any] = {
        "word_count_computed": wc,
        "h2_count": h2n,
        "keyword_density_pct": round(dens, 3),
        "checked_at": checked_at.isoformat(),
    }
    return GateResult(
        result=result,
        hard_failures=hard,
        warnings=warnings,
        gate_log=gate_log,
        checked_at=checked_at,
    )


def _has_conclusion_signal(body: str) -> bool:
    lower = body.lower()
    signals = (
        "in conclusion",
        "to conclude",
        "wrapping up",
        "key takeaways",
        "next steps",
        "finally,",
        "overall,",
    )
    # last 25% of body
    idx = int(len(lower) * 0.75)
    tail = lower[idx:]
    return any(s in tail for s in signals)


def validate_generated_post_dict(data: dict[str, Any]) -> list[str]:
    """Return list of schema errors (empty = ok)."""
    required = [
        "title",
        "meta_description",
        "slug",
        "body_markdown",
        "word_count",
        "keywords_used",
        "internal_links",
        "generated_at",
    ]
    errs: list[str] = []
    for k in required:
        if k not in data:
            errs.append(f"missing_field:{k}")
    return errs
