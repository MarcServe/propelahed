from __future__ import annotations

from seo_engine.engine.state import ContentBrief, EvaluationResult, LearningDelta, State
from seo_engine.engine.store import KnowledgeStore, _avoid_merge_key


def _derive_next_priority_topics(ev: EvaluationResult, brief: ContentBrief) -> list[str]:
    """
    Build a short editorial queue for Research from numeric gaps (not only "next:" lines in findings,
    which the stock evaluator rarely emits).
    """
    kw = (brief.target_keyword or "").strip() or "this topic"
    out: list[str] = []

    if ev.semantic_coverage < 18:
        out.append(f"Long-form explainer or comparison covering {kw} (fill topical gaps)")
    if ev.keyword_usage < 17:
        out.append(f"SEO-led piece on {kw} with keyword in title, first 100 words, and at least one H2")
    if ev.readability < 15:
        out.append(f"Plain-language primer on {kw} (short sentences, examples, minimal jargon)")
    if ev.structural_completeness < 15:
        out.append(f"Guide with strong headings and CTA on {kw} (intro, 3+ sections, conclusion)")
    if ev.internal_linking < 7:
        out.append(f"Cornerstone page on {kw} with multiple internal links to related live pages")

    for line in ev.findings:
        if "next" in line.lower() and ":" in line:
            parts = line.split(":", 1)
            if len(parts) > 1:
                t = parts[1].strip()[:200]
                if t:
                    out.append(t)

    if not out:
        out = [
            f"Deeper guide on {kw}",
            f"Case studies: {kw}",
        ]

    seen: set[str] = set()
    deduped: list[str] = []
    for x in out:
        key = x.lower()
        if key in seen:
            continue
        seen.add(key)
        deduped.append(x)
        if len(deduped) >= 5:
            break
    return deduped[:5]


def _derive_do_not_repeat(ev: EvaluationResult, brief: ContentBrief) -> list[str]:
    """
    Editorial \"avoid repeating\" lines from numeric gaps and evaluator flags.
    Populates the Learning \"Avoid\" list even when overall_score >= 60 but a dimension slipped.
    """
    out: list[str] = []

    for f in ev.flags:
        t = str(f).strip()
        if t:
            out.append(t)

    if ev.semantic_coverage < 18:
        out.append(
            "Avoid thin topical coverage vs the brief. Last draft scored low on topic depth; add substantiation and examples."
        )
    if ev.keyword_usage < 17:
        out.append(
            "Avoid burying the primary phrase. Last draft underused title, first 100 words, H2, or natural keyword density."
        )
    if ev.readability < 15:
        out.append(
            "Avoid readability outside the ideal band. Last draft needed plainer wording or shorter paragraphs."
        )
    if ev.structural_completeness < 15:
        out.append(
            "Avoid weak structure. Last draft needed clearer intro, more H2 sections, or a stronger conclusion/CTA."
        )
    if ev.internal_linking < 7:
        out.append(
            "Avoid shipping without enough internal links. Last draft needed more links to other pages on this site."
        )

    if ev.overall_score < 60:
        ang = (brief.angle or "").strip()
        if ang:
            out.append(f"Low score angle (treat as risky to repeat verbatim): {ang[:120]}")

    # De-dupe while preserving order; cap length for store merge / UI
    seen: set[str] = set()
    deduped: list[str] = []
    for x in out:
        key = x.lower()
        if key in seen:
            continue
        seen.add(key)
        deduped.append(x)
        if len(deduped) >= 12:
            break
    return deduped[:12]


def _annotate_new_lines(
    raw_lines: list[str],
    prev_merged: list[str] | None,
    article_title: str,
    *,
    max_new_bullets: int | None = None,
) -> list[str]:
    """
    If there are new lines vs the previous learning snapshot, group them under a header so the UI
    shows what was added from this article. Otherwise return the full raw list (merge dedupes).

    Uses ▸ so humanizeLearningCopy (which collapses runs of spaces) does not flatten sub-bullets.
    """
    prev = list(prev_merged or [])
    # Match merge semantics: ▸-prefixed bullets must compare equal to plain template lines.
    prev_keys = {_avoid_merge_key(p) for p in prev if p.strip()}
    new_only = [p for p in raw_lines if p.strip() and _avoid_merge_key(p) not in prev_keys]
    if max_new_bullets is not None and len(new_only) > max_new_bullets:
        new_only = new_only[: max_new_bullets]
    if new_only:
        title_short = ((article_title or "").strip() or "Untitled")[:160]
        out: list[str] = [f'New from last article («{title_short}»):']
        out.extend(f"▸ {line}" for line in new_only)
        return out
    return list(raw_lines)


def _annotate_new_quality_patterns(
    raw_patterns: list[str],
    prev_quality_patterns: list[str] | None,
    article_title: str,
) -> list[str]:
    """Backward-compatible name for tests / call sites."""
    return _annotate_new_lines(raw_patterns, prev_quality_patterns, article_title)


def run_learn(state: State, store: KnowledgeStore) -> None:
    state.stage_reached = 5
    if not state.evaluation or not state.post or not state.brief:
        state.errors.append("Learn: missing evaluation, post, or brief")
        return

    ev = state.evaluation
    post = state.post
    brief = state.brief
    cfg = state.config

    prev_learning = store.get_learning_state(cfg.client_id)
    prev_quality = list((prev_learning or {}).get("quality_patterns") or []) if prev_learning else []
    prev_priorities = list((prev_learning or {}).get("priority_topics") or []) if prev_learning else []
    prev_do_not = list((prev_learning or {}).get("do_not_repeat") or []) if prev_learning else []
    prev_keywords = list((prev_learning or {}).get("keyword_registry") or []) if prev_learning else []

    # Text findings from the evaluator, plus structured scores and gate soft warnings for "What we learned"
    # and for merge into quality_patterns (visible in the UI and in research/generate learning snapshots).
    patterns = list(ev.findings[:8])
    patterns.append(
        "Evaluator scores "
        f"(overall /100, subscores out of column max): "
        f"overall {ev.overall_score}; "
        f"topic_depth {ev.semantic_coverage}/25; "
        f"keywords {ev.keyword_usage}/25; "
        f"readability {ev.readability}/20; "
        f"structure {ev.structural_completeness}/20; "
        f"internal_links {ev.internal_linking}/10"
    )
    gr = state.gate_result
    if gr and gr.warnings:
        for w in gr.warnings:
            patterns.append(f"Draft quality gate (advisory, fix when possible): {w}")

    if ev.readability < 15:
        patterns.append(
            "Writing target for similar drafts: favour plain UK business English, short paragraphs, and concrete "
            "examples. Previous readability subscore was below the ideal band."
        )

    patterns = _annotate_new_lines(patterns, prev_quality, post.title)

    next_topics = _derive_next_priority_topics(ev, brief)
    next_topics = _annotate_new_lines(next_topics, prev_priorities, post.title)

    do_not = _derive_do_not_repeat(ev, brief)
    do_not = _annotate_new_lines(do_not, prev_do_not, post.title)

    kw_parts = {
        *(str(k).strip() for k in (post.keywords_used or []) if str(k).strip()),
        *(str(k).strip() for k in brief.secondary_keywords if str(k).strip()),
    }
    tk = str(brief.target_keyword or "").strip()
    if tk:
        kw_parts.add(tk)
    kw_raw = sorted(kw_parts)
    keywords_logged = _annotate_new_lines(kw_raw, prev_keywords, post.title, max_new_bullets=25)

    delta = LearningDelta(
        topic_added=post.title,
        keywords_logged=keywords_logged,
        quality_score_logged=ev.overall_score,
        patterns_observed=patterns,
        next_priority_topics=next_topics,
        do_not_repeat=do_not,
    )
    state.learning_delta = delta
    store.update_learning(cfg.client_id, state.loop_id, delta)

    if state.article_row_id is not None and ev.overall_score < 60:
        store.set_article_underperforming(state.article_row_id, True)

    if state.article_row_id is not None:
        store.log_evaluation(
            {
                "article_id": state.article_row_id,
                "loop_id": state.loop_id,
                "overall_score": ev.overall_score,
                "semantic_coverage": ev.semantic_coverage,
                "keyword_usage": ev.keyword_usage,
                "readability": ev.readability,
                "structural_completeness": ev.structural_completeness,
                "internal_linking": ev.internal_linking,
                "findings": ev.findings,
                "flags": ev.flags,
            }
        )
