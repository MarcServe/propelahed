from __future__ import annotations

import json
import re
from pathlib import Path

from anthropic import Anthropic

MODEL = "claude-sonnet-4-20250514"


def _package_root() -> Path:
    return Path(__file__).resolve().parent.parent


def _load_prompt(name: str) -> str:
    p = _package_root() / "prompts" / name
    return p.read_text(encoding="utf-8")


def _extract_json(text: str) -> dict:
    text = text.strip()
    m = re.search(r"```(?:json)?\s*([\s\S]*?)```", text)
    if m:
        text = m.group(1).strip()
    return json.loads(text)


def call_llm_json(system_prompt: str, user_message: str, api_key: str | None) -> dict:
    client = Anthropic(api_key=api_key)
    msg = client.messages.create(
        model=MODEL,
        max_tokens=8192,
        system=system_prompt,
        messages=[{"role": "user", "content": user_message}],
    )
    parts = []
    for block in msg.content:
        if block.type == "text":
            parts.append(block.text)
    raw = "".join(parts)
    return _extract_json(raw)


def build_research_prompts(
    *,
    learning_snapshot: str,
    keyword_json: str,
    config_yaml_summary: str,
    excluded: str,
    deduped_candidates: str,
    published_articles_catalog: str,
) -> tuple[str, str]:
    system = _load_prompt("research.txt")
    system = system.replace("{{LEARNING_SNAPSHOT}}", learning_snapshot)
    system = system.replace("{{KEYWORD_GAPS}}", keyword_json)
    system = system.replace("{{CLIENT_CONFIG_SUMMARY}}", config_yaml_summary)
    system = system.replace("{{EXCLUDED_TOPICS}}", excluded)
    system = system.replace("{{DEDUPED_CANDIDATES}}", deduped_candidates)
    system = system.replace("{{PUBLISHED_ARTICLES_CATALOG}}", published_articles_catalog)
    user = (
        "Return a single JSON object matching the ContentBrief schema exactly:\n"
        '{"target_keyword": str, "secondary_keywords": [str], "title_suggestion": str, '
        '"angle": str, "target_word_count": int, "audience_note": str, '
        '"internal_link_candidates": [str], "avoid_topics": [str], "rationale": str}\n'
        "Use only UTF-8. No markdown outside the JSON object."
    )
    return system, user


def build_generate_prompts(
    *,
    brief_json: str,
    primary_keyword: str,
    domain: str,
    tone: str,
    audience: str,
    brand_notes: str,
    target_word_count: int,
    learning_snapshot: str,
) -> tuple[str, str]:
    pk = primary_keyword.strip() or "(none)"
    system = _load_prompt("generate.txt")
    snap = (learning_snapshot or "").strip() or "(no prior learning rows yet for this workspace)"
    system = (
        system.replace("{{BRIEF_JSON}}", brief_json)
        .replace("{{PRIMARY_KEYWORD}}", pk)
        .replace("{{DOMAIN}}", domain)
        .replace("{{TONE}}", tone)
        .replace("{{AUDIENCE}}", audience)
        .replace("{{BRAND_VOICE_NOTES}}", brand_notes or "(none)")
        .replace("{{TARGET_WORD_COUNT}}", str(target_word_count))
        .replace("{{LEARNING_SNAPSHOT}}", snap)
    )
    user = (
        "Return one JSON object for GeneratedPost:\n"
        '{"title": str, "meta_description": str, "slug": str, "body_markdown": str, '
        '"word_count": int, "keywords_used": [str], "internal_links": [{"slug": str, "anchor": str}], '
        '"generated_at": str ISO-8601}\n'
        f'Before returning: confirm the "title" string contains this exact substring (any casing): {pk!r}\n'
        "The system prompt includes workspace learning (including recent reviewer findings). "
        "Improve on those patterns in this draft: keyword in title, opening, and at least one H2; natural density; "
        "[LINK: slug] placeholders; readable sentences.\n"
        "Use [LINK: slug] placeholders in body_markdown for internal links where relevant. "
        "Include intro, at least 3 H2 sections (## ), and a conclusion with a CTA. "
        "No text outside JSON."
    )
    return system, user


def semantic_coverage_score(
    *,
    body: str,
    target_keyword: str,
    api_key: str | None,
) -> tuple[float, str]:
    """LLM returns 0-25 score and one-line justification."""
    system = (
        "You score how well the article comprehensively covers the target topic for SEO. "
        "Output JSON only: {\"score\": number 0-25, \"justification\": string}."
    )
    user = f"Target keyword/topic: {target_keyword}\n\nArticle markdown:\n{body[:12000]}"
    data = call_llm_json(system, user, api_key=api_key)
    score = float(data.get("score", 0))
    score = max(0.0, min(25.0, score))
    justification = str(data.get("justification", "")).strip()
    return score, justification
