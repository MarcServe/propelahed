from __future__ import annotations

from seo_engine.engine.state import ContentBrief, EvaluationResult, LearningDelta, State
from seo_engine.engine.store import KnowledgeStore


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
        out.append(f"Cornerstone page on {kw} with multiple internal [LINK: slug] placements")

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
            "Avoid thin topical coverage vs the brief—last draft scored low on topic depth; add substantiation and examples."
        )
    if ev.keyword_usage < 17:
        out.append(
            "Avoid burying the primary phrase—last draft underused title, first 100 words, H2, or natural keyword density."
        )
    if ev.readability < 15:
        out.append(
            "Avoid readability outside the ideal band—last draft needed plainer wording or shorter paragraphs."
        )
    if ev.structural_completeness < 15:
        out.append(
            "Avoid weak structure—last draft needed clearer intro, more H2 sections, or a stronger conclusion/CTA."
        )
    if ev.internal_linking < 7:
        out.append(
            "Avoid shipping without enough internal links—last draft needed more relevant [LINK: slug] placements."
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


def run_learn(state: State, store: KnowledgeStore) -> None:
    state.stage_reached = 5
    if not state.evaluation or not state.post or not state.brief:
        state.errors.append("Learn: missing evaluation, post, or brief")
        return

    ev = state.evaluation
    post = state.post
    brief = state.brief
    cfg = state.config

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
            "examples—previous readability subscore was below the ideal band."
        )

    next_topics = _derive_next_priority_topics(ev, brief)
    do_not = _derive_do_not_repeat(ev, brief)

    delta = LearningDelta(
        topic_added=post.title,
        keywords_logged=list({*(post.keywords_used or []), brief.target_keyword, *brief.secondary_keywords}),
        quality_score_logged=ev.overall_score,
        patterns_observed=patterns,
        next_priority_topics=next_topics[:5],
        do_not_repeat=do_not[:12],
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
