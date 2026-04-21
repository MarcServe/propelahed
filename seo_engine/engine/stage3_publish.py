from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

import yaml

from seo_engine.engine.state import State
from seo_engine.engine.store import KnowledgeStore


def run_publish(state: State, store: KnowledgeStore, *, config_path: Path) -> None:
    state.stage_reached = 3
    cfg = state.config
    if cfg.publish_destination != "LOCAL_MARKDOWN":
        raise NotImplementedError(
            f"publish_destination {cfg.publish_destination!r} is not implemented in MVP (LOCAL_MARKDOWN only)."
        )
    if not state.post or not state.gate_result:
        state.errors.append("Publish: missing post or gate result")
        return

    post = state.post
    out_dir = Path(cfg.output_dir)
    if not out_dir.is_absolute():
        # config lives in seo_engine/config/*.yaml → anchor relative paths to seo_engine/
        base = config_path.parent.parent
        out_dir = (base / out_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / f"{post.slug}.md"

    front = {
        "title": post.title,
        "description": post.meta_description,
        "date": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "keywords": post.keywords_used,
        "slug": post.slug,
        "client_id": cfg.client_id,
        "loop_id": state.loop_id,
    }
    content = "---\n" + yaml.safe_dump(front, sort_keys=False) + "---\n\n" + post.body_markdown
    path.write_text(content, encoding="utf-8")
    state.publish_path = str(path)

    if not state.brief:
        state.errors.append("Publish: missing brief for logging")
        return

    article_id = store.log_article(
        {
            "loop_id": state.loop_id,
            "client_id": cfg.client_id,
            "slug": post.slug,
            "title": post.title,
            "primary_keyword": state.brief.target_keyword,
            "secondary_keywords": state.brief.secondary_keywords,
            "word_count": post.word_count,
            "publish_path": state.publish_path,
            "published_at": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S"),
            "gate_result": state.gate_result.result,
            "gate_failures": [],
            "underperforming": False,
        }
    )
    state.article_row_id = article_id
