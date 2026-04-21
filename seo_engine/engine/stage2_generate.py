from __future__ import annotations

import json
import os
from dataclasses import replace
from datetime import datetime, timezone
from typing import Any

from slugify import slugify

from seo_engine.engine.gate import (
    GateFailException,
    primary_keyword_in_text,
    run_gate,
    validate_generated_post_dict,
    word_count_body,
)
from seo_engine.engine.internal_links import resolve_link_placeholders, slug_title_map_from_articles
from seo_engine.engine.llm import build_generate_prompts, call_llm_json
from seo_engine.engine.state import ContentBrief, GeneratedPost, State
from seo_engine.engine.store import KnowledgeStore, learning_snapshot_text


def draft_snapshot_for_gate(
    brief: ContentBrief,
    post: GeneratedPost | None,
    *,
    parse_failed: bool = False,
) -> dict[str, Any]:
    """Persist what the model produced (or tried to) when the gate fails, for the UI."""
    snap: dict[str, Any] = {
        "target_keyword": brief.target_keyword,
        "brief_title_suggestion": brief.title_suggestion,
        "brief_angle": brief.angle,
        "secondary_keywords": list(brief.secondary_keywords)[:15],
        "parse_failed": parse_failed,
    }
    if post:
        snap["title"] = post.title
        snap["slug"] = post.slug
        snap["meta_description"] = post.meta_description
        snap["word_count"] = post.word_count
        snap["body_excerpt"] = (post.body_markdown or "")[:3500]
        snap["keywords_used"] = list(post.keywords_used)[:25]
    return snap


def run_generate(state: State, store: KnowledgeStore) -> None:
    state.stage_reached = 2
    if not state.brief:
        state.errors.append("Generate: missing brief")
        return

    cfg = state.config
    brief = state.brief
    brief_json = json.dumps(
        {
            "target_keyword": brief.target_keyword,
            "secondary_keywords": brief.secondary_keywords,
            "title_suggestion": brief.title_suggestion,
            "angle": brief.angle,
            "target_word_count": brief.target_word_count,
            "audience_note": brief.audience_note,
            "internal_link_candidates": brief.internal_link_candidates,
            "avoid_topics": brief.avoid_topics,
            "rationale": brief.rationale,
        },
        indent=2,
    )
    system, user = build_generate_prompts(
        brief_json=brief_json,
        primary_keyword=brief.target_keyword,
        domain=cfg.domain,
        tone=cfg.tone,
        audience=cfg.target_audience,
        brand_notes=cfg.brand_voice_notes or "",
        target_word_count=brief.target_word_count or cfg.target_word_count,
        learning_snapshot=learning_snapshot_text(store, cfg.client_id),
    )
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    raw = call_llm_json(system, user, api_key=api_key)

    schema_errs = validate_generated_post_dict(raw)
    published = store.get_published_titles_and_slugs(cfg.client_id)

    try:
        gen_at = datetime.fromisoformat(str(raw["generated_at"]).replace("Z", "+00:00"))
    except Exception:
        gen_at = datetime.now(timezone.utc)

    try:
        slug = str(raw.get("slug") or "").strip() or slugify(str(raw["title"]))[:80]
        post = GeneratedPost(
            title=str(raw["title"]),
            meta_description=str(raw["meta_description"]),
            slug=slug,
            body_markdown=str(raw["body_markdown"]),
            word_count=int(raw.get("word_count") or word_count_body(str(raw["body_markdown"]))),
            keywords_used=[str(x) for x in (raw.get("keywords_used") or [])],
            internal_links=list(raw.get("internal_links") or []),
            generated_at=gen_at,
        )
        kw = brief.target_keyword.strip()
        if kw and not primary_keyword_in_text(kw, post.title):
            new_title = f"{kw} — {post.title}".strip()
            if len(new_title) > 200:
                new_title = new_title[:200]
            new_slug = slugify(new_title)[:80] or slug
            post = replace(post, title=new_title, slug=new_slug)

        art_rows = store.list_articles(cfg.client_id, limit=120)
        slug_map = slug_title_map_from_articles(art_rows)
        resolved_body = resolve_link_placeholders(post.body_markdown, cfg, slug_map)
        post = replace(
            post,
            body_markdown=resolved_body,
            word_count=word_count_body(resolved_body),
        )
    except (KeyError, TypeError, ValueError) as e:
        gate_res = run_gate(
            GeneratedPost(
                title="",
                meta_description="",
                slug="",
                body_markdown="",
                word_count=0,
                keywords_used=[],
                internal_links=[],
                generated_at=gen_at,
            ),
            brief,
            cfg,
            published,
        )
        gate_res.hard_failures = [*gate_res.hard_failures, f"parse_error:{e}", *[f"schema:{x}" for x in schema_errs]]
        gate_res.result = "FAIL"
        state.gate_result = gate_res
        store.log_gate_failure(
            cfg.client_id,
            state.loop_id,
            gate_res.hard_failures,
            gate_res.warnings,
            draft_snapshot=draft_snapshot_for_gate(brief, None, parse_failed=True),
        )
        raise GateFailException(gate_res) from e

    gate_res = run_gate(post, brief, cfg, published)
    if schema_errs:
        gate_res.hard_failures = [*gate_res.hard_failures, *[f"schema:{e}" for e in schema_errs]]
        gate_res.result = "FAIL"

    state.post = post
    state.gate_result = gate_res

    if gate_res.result == "FAIL":
        store.log_gate_failure(
            cfg.client_id,
            state.loop_id,
            gate_res.hard_failures,
            gate_res.warnings,
            draft_snapshot=draft_snapshot_for_gate(brief, post),
        )
        raise GateFailException(gate_res)
