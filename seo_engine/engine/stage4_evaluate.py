from __future__ import annotations

import os
import re

import textstat

from seo_engine.engine.gate import count_h2_atx, keyword_density, opening_text, primary_keyword_in_text
from seo_engine.engine.llm import semantic_coverage_score
from seo_engine.engine.state import EvaluationResult, State


def _first_n_words(text: str, n: int) -> str:
    words = re.findall(r"\S+", text)
    return " ".join(words[:n])


def _h2_contains_keyword(body: str, kw: str) -> bool:
    for line in body.splitlines():
        if re.match(r"^##\s+[^#]", line):
            if primary_keyword_in_text(kw, line):
                return True
    return False


def _score_keyword_usage(title: str, body: str, kw: str) -> float:
    pts = 0.0
    if primary_keyword_in_text(kw, title):
        pts += 6.0
    if primary_keyword_in_text(kw, _first_n_words(body, 100)):
        pts += 6.0
    if _h2_contains_keyword(body, kw):
        pts += 6.0
    dens = keyword_density(body, kw)
    if 0.5 <= dens <= 2.5:
        pts += 7.0
    elif 0.25 <= dens < 0.5 or 2.5 < dens <= 3.5:
        pts += 3.5
    elif dens > 0:
        pts += 1.5
    return min(25.0, pts)


def _score_readability(body: str) -> float:
    try:
        fk = textstat.flesch_reading_ease(body)
    except Exception:
        return 10.0
    if 60 <= fk <= 80:
        return 20.0
    if fk < 60:
        return max(0.0, 20.0 * (fk / 60.0))
    return max(0.0, 20.0 * (1.0 - (fk - 80) / 40.0))


def _has_intro(body: str) -> bool:
    lines = [ln for ln in body.strip().splitlines() if ln.strip()]
    if not lines:
        return False
    first = lines[0]
    if first.startswith("#"):
        return False
    return len(first.split()) >= 40


def _score_structural(body: str) -> float:
    pts = 0.0
    h2 = count_h2_atx(body)
    if h2 >= 3:
        pts += 8.0
    elif h2 == 2:
        pts += 4.0
    else:
        pts += 0.0
    lower = body.lower()
    if _has_intro(body):
        pts += 4.0
    tail = lower[int(len(lower) * 0.7) :]
    if any(
        x in tail
        for x in (
            "conclusion",
            "takeaway",
            "next step",
            "get in touch",
            "contact",
            "book",
        )
    ):
        pts += 4.0
    if any(x in lower for x in ("contact us", "get started", "book a", "request", "try ", "today")):
        pts += 4.0
    return min(20.0, pts)


def _internal_link_slugs(body: str) -> list[str]:
    return re.findall(r"\[LINK:\s*([^\]]+?)\s*\]", body, flags=re.IGNORECASE)


def _score_internal_linking(body: str) -> float:
    slugs = [s.strip() for s in _internal_link_slugs(body) if s.strip()]
    distinct = {s.lower() for s in slugs}
    if not distinct:
        return 0.0
    if len(distinct) >= 2:
        return 10.0
    return 5.0


def run_evaluate(state: State) -> None:
    state.stage_reached = 4
    if not state.post or not state.brief:
        state.errors.append("Evaluate: missing post or brief")
        return

    post = state.post
    brief = state.brief
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    sem, just = semantic_coverage_score(
        body=post.body_markdown,
        target_keyword=brief.target_keyword,
        api_key=api_key,
    )

    kw_u = _score_keyword_usage(post.title, post.body_markdown, brief.target_keyword)
    read = _score_readability(post.body_markdown)
    struct = _score_structural(post.body_markdown)
    il = _score_internal_linking(post.body_markdown)

    overall = sem + kw_u + read + struct + il
    findings: list[str] = []
    if just:
        findings.append(just)
    if kw_u < 20:
        findings.append("Keyword usage could be stronger (title, opening, H2, density).")
    if read < 15:
        findings.append("Readability outside ideal band; simplify or add depth.")
    if struct < 15:
        findings.append("Structure: strengthen intro, H2 depth, conclusion, or CTA.")
    if il < 8:
        findings.append("Add more relevant internal [LINK: slug] placeholders.")

    flags: list[str] = []
    if overall < 60:
        flags.append("underperforming_overall_score")

    state.evaluation = EvaluationResult(
        overall_score=round(overall, 2),
        semantic_coverage=round(sem, 2),
        keyword_usage=round(kw_u, 2),
        readability=round(read, 2),
        structural_completeness=round(struct, 2),
        internal_linking=round(il, 2),
        findings=findings,
        flags=flags,
    )
