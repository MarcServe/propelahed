"""SQLite store round-trip (no LLM)."""

from pathlib import Path

import pytest

from seo_engine.engine.state import LearningDelta
from seo_engine.engine.store import KnowledgeStore


@pytest.fixture
def tmp_db(tmp_path: Path) -> Path:
    return tmp_path / "test.db"


def test_log_article_evaluation_and_learning(tmp_db: Path) -> None:
    store = KnowledgeStore(tmp_db)
    try:
        aid = store.log_article(
            {
                "loop_id": "loop-1",
                "client_id": "c1",
                "slug": "hello-world",
                "title": "Hello",
                "primary_keyword": "hello",
                "secondary_keywords": ["a", "b"],
                "word_count": 100,
                "publish_path": "/tmp/x.md",
                "published_at": "2026-01-01 00:00:00",
                "gate_result": "PASS",
                "gate_failures": [],
                "underperforming": False,
            }
        )
        assert aid > 0

        store.log_evaluation(
            {
                "article_id": aid,
                "loop_id": "loop-1",
                "overall_score": 72.0,
                "semantic_coverage": 18.0,
                "keyword_usage": 20.0,
                "readability": 12.0,
                "structural_completeness": 14.0,
                "internal_linking": 8.0,
                "findings": ["ok"],
                "flags": [],
            }
        )

        delta = LearningDelta(
            topic_added="Hello",
            keywords_logged=["hello", "world"],
            quality_score_logged=72.0,
            patterns_observed=["pattern-a"],
            next_priority_topics=["next-topic"],
            do_not_repeat=["avoid-x"],
        )
        store.update_learning("c1", "loop-1", delta)

        topics = store.get_covered_topics("c1")
        assert len(topics) == 1
        assert topics[0]["slug"] == "hello-world"

        st = store.get_learning_state("c1")
        assert st is not None
        assert "next-topic" in (st.get("priority_topics") or [])

        arts = store.list_articles("c1", limit=10)
        assert len(arts) == 1
        evals = store.list_evaluations("c1", limit=10)
        assert len(evals) == 1
    finally:
        store.close()


def test_gate_events_round_trip(tmp_db: Path) -> None:
    store = KnowledgeStore(tmp_db)
    try:
        snap = {"title": "Test title", "body_excerpt": "## Hello\n\nBody here.", "target_keyword": "test kw"}
        store.log_gate_failure("c1", "loop-x", ["minimum_word_count"], ["warn"], draft_snapshot=snap)
        rows = store.list_gate_failures("c1")
        assert len(rows) == 1
        assert rows[0]["hard_failures"] == ["minimum_word_count"]
        assert rows[0]["warnings"] == ["warn"]
        assert rows[0]["draft_snapshot"] == snap
    finally:
        store.close()


def test_research_hint_round_trip(tmp_db: Path) -> None:
    store = KnowledgeStore(tmp_db)
    try:
        assert store.get_research_hint("c1")["hint"] == ""
        store.set_research_hint("c1", "Focus on SMEs")
        h = store.get_research_hint("c1")
        assert h["hint"] == "Focus on SMEs"
        assert h["updated_at"]
    finally:
        store.close()


def test_research_hint_snapshot_and_history(tmp_db: Path) -> None:
    store = KnowledgeStore(tmp_db)
    try:
        store.set_research_hint("c1", "Operator line")
        store.insert_research_hint_snapshot("c1", "loop-run-1", "Operator line")
        aid = store.log_article(
            {
                "loop_id": "loop-run-1",
                "client_id": "c1",
                "slug": "my-slug",
                "title": "My Article",
                "primary_keyword": "kw",
                "secondary_keywords": [],
                "word_count": 50,
                "publish_path": "/tmp/x.md",
                "published_at": "2026-01-01",
                "gate_result": "PASS",
                "gate_failures": [],
                "underperforming": False,
            }
        )
        rows = store.list_research_hint_history("c1", limit=10)
        assert len(rows) == 1
        assert rows[0]["loop_id"] == "loop-run-1"
        assert rows[0]["hint_text"] == "Operator line"
        assert rows[0]["article_title"] == "My Article"
        assert rows[0]["article_slug"] == "my-slug"

        got = store.get_article("c1", aid)
        assert got is not None
        assert got["title"] == "My Article"
    finally:
        store.close()


def test_loop_runs_round_trip(tmp_db: Path) -> None:
    store = KnowledgeStore(tmp_db)
    try:
        store.log_loop_run(
            client_id="c1",
            loop_id="abc-123",
            status="succeeded",
            stage_reached=5,
            publish_path="/out/x.md",
        )
        store.log_loop_run(
            client_id="c1",
            loop_id="def-456",
            status="failed",
            stage_reached=2,
            error_message="Quality gate failed",
            gate_failures=["minimum_word_count"],
        )
        store.log_article(
            {
                "loop_id": "abc-123",
                "client_id": "c1",
                "slug": "acme-widget",
                "title": "Why Acme widgets win",
                "primary_keyword": "acme widget review",
                "secondary_keywords": [],
                "word_count": 100,
                "publish_path": "/out/x.md",
                "published_at": "2026-01-01",
                "gate_result": "PASS",
                "gate_failures": [],
                "underperforming": False,
            }
        )
        rows = store.list_loop_runs("c1", limit=10)
        assert len(rows) == 2
        assert rows[0]["loop_id"] == "def-456"
        assert rows[0]["status"] == "failed"
        assert rows[0]["article_title"] is None
        assert rows[1]["loop_id"] == "abc-123"
        assert rows[1]["status"] == "succeeded"
        assert rows[1]["article_title"] == "Why Acme widgets win"
        assert rows[1]["article_slug"] == "acme-widget"
        assert rows[1]["article_primary_keyword"] == "acme widget review"
    finally:
        store.close()
