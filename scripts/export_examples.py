#!/usr/bin/env python3
"""Export the latest successful loop artifacts from SQLite into examples/ for GitHub.

Run after ``python main.py --config ...`` so ``data/{client_id}.db`` contains
evaluations, learning_store, and article paths. Commits the generated files when
you want reviewers to see current shapes without running the engine.

Usage::

    export PYTHONPATH=.
    python scripts/export_examples.py --client talkweb
"""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

from seo_engine.engine.orchestrator import REPO_ROOT
from seo_engine.engine.store import KnowledgeStore


def _evaluated_at_iso(evaluated_at: str | None) -> str:
    if not evaluated_at:
        return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    s = evaluated_at.strip()
    try:
        if "T" in s:
            if s.endswith("Z") or "+" in s:
                return s
            return s[:19] + "Z" if len(s) >= 19 else s
        dt = datetime.strptime(s[:19], "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)
        return dt.strftime("%Y-%m-%dT%H:%M:%SZ")
    except ValueError:
        return s


def main() -> int:
    parser = argparse.ArgumentParser(description="Export latest DB artifacts into examples/")
    parser.add_argument(
        "--client",
        default="talkweb",
        help="client_id (default: talkweb); reads data/{client}.db",
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=None,
        help="Output directory (default: <repo>/examples)",
    )
    parser.add_argument(
        "--max-article-chars",
        type=int,
        default=0,
        metavar="N",
        help="If >0, truncate article body after front matter to N chars (keeps YAML block intact).",
    )
    args = parser.parse_args()
    out_dir = Path(args.out).resolve() if args.out else (REPO_ROOT / "examples")
    out_dir.mkdir(parents=True, exist_ok=True)

    db_path = REPO_ROOT / "data" / f"{args.client}.db"
    if not db_path.is_file():
        print(f"error: no database at {db_path} — run a loop first.", flush=True)
        return 2

    store = KnowledgeStore(db_path)
    try:
        evals = store.list_evaluations(args.client, limit=1)
        if not evals:
            print(f"error: no evaluations for client {args.client!r} — complete a loop first.", flush=True)
            return 2

        ev = evals[0]
        article = store.get_article(args.client, int(ev["article_id"]))
        if not article:
            print("error: article row missing for latest evaluation.", flush=True)
            return 2

        learning_rows = store.list_learning_history(args.client, limit=40)
        if not learning_rows:
            print("error: learning_store is empty — complete a loop with learn stage first.", flush=True)
            return 2

        ev_loop = str(ev.get("loop_id") or "")
        learn = next((r for r in learning_rows if str(r.get("loop_id")) == ev_loop), learning_rows[0])

        eval_out = {
            "_comment": "Exported by scripts/export_examples.py; shape matches GET /api/clients/{id}/evaluations.",
            "id": ev["id"],
            "article_id": ev["article_id"],
            "loop_id": ev["loop_id"],
            "overall_score": ev["overall_score"],
            "semantic_coverage": ev["semantic_coverage"],
            "keyword_usage": ev["keyword_usage"],
            "readability": ev["readability"],
            "structural_completeness": ev["structural_completeness"],
            "internal_linking": ev["internal_linking"],
            "findings": ev["findings"],
            "flags": ev["flags"],
            "evaluated_at": _evaluated_at_iso(ev.get("evaluated_at")),
            "slug": ev.get("slug"),
            "title": ev.get("title"),
        }
        eval_path = out_dir / "evaluation-sample.json"
        eval_path.write_text(json.dumps(eval_out, indent=2) + "\n", encoding="utf-8")
        print(f"wrote {eval_path.relative_to(REPO_ROOT)}", flush=True)

        learn_out = {
            "_comment": "Exported by scripts/export_examples.py; one learning_store row after merge (JSON columns parsed; matches GET /api/clients/{id}/learning).",
            "id": learn["id"],
            "client_id": learn["client_id"],
            "loop_id": learn["loop_id"],
            "updated_at": learn.get("updated_at"),
            "article_title": learn.get("article_title"),
            "article_slug": learn.get("article_slug"),
            "priority_topics": learn.get("priority_topics") or [],
            "do_not_repeat": learn.get("do_not_repeat") or [],
            "quality_patterns": learn.get("quality_patterns") or [],
            "keyword_registry": learn.get("keyword_registry") or [],
        }
        learn_path = out_dir / "learning-store-sample.json"
        learn_path.write_text(json.dumps(learn_out, indent=2) + "\n", encoding="utf-8")
        print(f"wrote {learn_path.relative_to(REPO_ROOT)}", flush=True)

        pub = (article.get("publish_path") or "").strip()
        art_path = out_dir / "article-sample.md"
        if pub:
            src = Path(pub)
            if not src.is_file():
                print(f"warning: publish_path not found ({src}); skipping article export.", flush=True)
            else:
                text = src.read_text(encoding="utf-8")
                if args.max_article_chars and args.max_article_chars > 0:
                    if text.startswith("---"):
                        parts = text.split("---", 2)
                        if len(parts) >= 3:
                            front = f"---{parts[1]}---"
                            body = parts[2]
                            if len(body) > args.max_article_chars:
                                body = body[: args.max_article_chars].rstrip() + "\n\n<!-- truncated by export_examples.py -->\n"
                            text = front + body
                art_path.write_text(text, encoding="utf-8")
                print(f"wrote {art_path.relative_to(REPO_ROOT)}", flush=True)
        else:
            print("warning: no publish_path on article; skipping article-sample.md.", flush=True)

    finally:
        store.close()

    print("done. Review diffs, then git add examples/ and commit.", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
