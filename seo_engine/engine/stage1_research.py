from __future__ import annotations

import json
import os
from typing import Any

from seo_engine.engine.gate import similarity_ratio
from seo_engine.engine.keywords import fetch_keyword_gaps
from seo_engine.engine.llm import build_research_prompts, call_llm_json
from seo_engine.engine.state import ClientConfig, ContentBrief, State
from seo_engine.engine.store import KnowledgeStore, learning_snapshot_text


def _covered_strings(store: KnowledgeStore, client_id: str) -> list[str]:
    out: list[str] = []
    for row in store.get_covered_topics(client_id):
        out.append(str(row.get("title", "")))
        out.append(str(row.get("primary_keyword", "")))
        out.append(str(row.get("slug", "")))
    return [s for s in out if s.strip()]


def _is_too_similar_to_covered(candidate: str, covered: list[str]) -> bool:
    c = candidate.strip()
    if not c:
        return True
    for s in covered:
        if similarity_ratio(c, s) > 0.85:
            return True
    return False


def list_topic_candidates(config: ClientConfig, store: KnowledgeStore) -> list[str]:
    """Topics/phrases available for manual selection (same pool the auto research step uses)."""
    return _dedupe_candidates(config, store)


def _dedupe_candidates(config: ClientConfig, store: KnowledgeStore) -> list[str]:
    covered = _covered_strings(store, config.client_id)
    gaps = fetch_keyword_gaps(config)
    candidates: list[str] = []
    for item in gaps.get("gaps") or []:
        kw = str(item.get("keyword", "")).strip()
        if kw:
            candidates.append(kw)
    for t in config.topic_cluster:
        if str(t).strip():
            candidates.append(str(t).strip())

    seen: set[str] = set()
    deduped: list[str] = []
    for c in candidates:
        key = c.lower()
        if key in seen:
            continue
        if c in (config.excluded_topics or []):
            continue
        if _is_too_similar_to_covered(c, covered):
            continue
        seen.add(key)
        deduped.append(c)
    return deduped


def validate_manual_target_keyword(
    config: ClientConfig, store: KnowledgeStore, keyword: str
) -> str | None:
    """Return an error message if the operator-chosen phrase should not run; else None."""
    k = keyword.strip()
    if not k:
        return "Enter a main topic phrase, or switch to automatic topic choice."
    excluded = {str(x).strip().lower() for x in (config.excluded_topics or []) if str(x).strip()}
    if k.lower() in excluded:
        return "That topic is on your excluded list in Settings."
    covered = _covered_strings(store, config.client_id)
    if _is_too_similar_to_covered(k, covered):
        return (
            "That phrase is too similar to an article you already published. "
            "Try a more specific angle or pick another topic."
        )
    return None


def build_manual_content_brief(
    config: ClientConfig,
    *,
    target_keyword: str,
    title_suggestion: str,
    angle: str,
    secondary_keywords: list[str],
) -> ContentBrief:
    """Build a brief without calling the research LLM (operator chose topic on the UI)."""
    kw = target_keyword.strip()
    title = title_suggestion.strip() or f"A practical guide to {kw}"
    ang = angle.strip() or (
        f"Cover {kw} in plain language for your readers: what matters, common pitfalls, and practical next steps."
    )
    secs = [s.strip() for s in secondary_keywords if s.strip()][:30]
    return ContentBrief(
        target_keyword=kw,
        secondary_keywords=secs,
        title_suggestion=title[:400],
        angle=ang[:4000],
        target_word_count=config.target_word_count,
        audience_note=(config.target_audience or "")[:4000],
        internal_link_candidates=[],
        avoid_topics=list(config.excluded_topics or []),
        rationale="Topic and outline were set on the Write new article page before this run.",
    )


def run_research(
    state: State, store: KnowledgeStore, *, prefilled_brief: ContentBrief | None = None
) -> None:
    state.stage_reached = 1
    cfg = state.config
    if prefilled_brief is not None:
        state.brief = prefilled_brief
        return

    deduped = _dedupe_candidates(cfg, store)
    if not deduped:
        state.errors.append(
            "Research aborted: no candidate topics remain after deduplication against covered content."
        )
        return

    learning_snapshot = learning_snapshot_text(store, cfg.client_id)
    keyword_json = json.dumps(fetch_keyword_gaps(cfg), indent=2)
    config_summary = json.dumps(
        {
            "client_id": cfg.client_id,
            "domain": cfg.domain,
            "topic_cluster": cfg.topic_cluster,
            "target_audience": cfg.target_audience,
            "tone": cfg.tone,
            "target_word_count": cfg.target_word_count,
        },
        indent=2,
    )
    excluded = json.dumps(cfg.excluded_topics or [], indent=2)
    deduped_s = json.dumps(deduped, indent=2)
    published_rows = store.list_articles(cfg.client_id, limit=100)
    published_catalog = json.dumps(
        [{"slug": r["slug"], "title": r["title"]} for r in published_rows],
        indent=2,
    )

    system, user = build_research_prompts(
        learning_snapshot=learning_snapshot,
        keyword_json=keyword_json,
        config_yaml_summary=config_summary,
        excluded=excluded,
        deduped_candidates=deduped_s,
        published_articles_catalog=published_catalog,
    )
    op_hint = (store.get_research_hint(cfg.client_id).get("hint") or "").strip()
    if op_hint:
        user += (
            "\n\n=== Operator research guidance (from dashboard) ===\n"
            "The human operator asked you to strongly bias the brief toward the following. "
            "Respect config excluded topics and deduplication rules; use this as steering, not as a license to ignore constraints.\n\n"
            + op_hint
        )
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    raw = call_llm_json(system, user, api_key=api_key)
    try:
        state.brief = ContentBrief(
            target_keyword=str(raw["target_keyword"]),
            secondary_keywords=list(raw.get("secondary_keywords") or []),
            title_suggestion=str(raw["title_suggestion"]),
            angle=str(raw["angle"]),
            target_word_count=int(raw.get("target_word_count") or cfg.target_word_count),
            audience_note=str(raw.get("audience_note", "")),
            internal_link_candidates=list(raw.get("internal_link_candidates") or []),
            avoid_topics=list(raw.get("avoid_topics") or []),
            rationale=str(raw.get("rationale", "")),
        )
    except (KeyError, TypeError, ValueError) as e:
        state.errors.append(f"Research failed to parse ContentBrief: {e}")
