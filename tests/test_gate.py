from datetime import datetime, timezone

import pytest

from seo_engine.engine.gate import run_gate, similarity_ratio, word_count_body
from seo_engine.engine.state import ClientConfig, ContentBrief, GeneratedPost


def _cfg() -> ClientConfig:
    return ClientConfig(
        client_id="t",
        domain="example.com",
        topic_cluster=["a"],
        target_audience="SMB",
        tone="plain",
        publish_destination="LOCAL_MARKDOWN",
        output_dir="./out",
    )


def _brief() -> ContentBrief:
    return ContentBrief(
        target_keyword="widget",
        secondary_keywords=[],
        title_suggestion="x",
        angle="y",
        target_word_count=800,
        audience_note="z",
        internal_link_candidates=[],
        avoid_topics=[],
        rationale="r",
    )


def _post(**kwargs: object) -> GeneratedPost:
    defaults = dict(
        title="Why widget matters for SMEs",
        meta_description="Learn how widget helps SMEs. Practical tips under 160 characters here.",
        slug="why-widget-smes",
        body_markdown=(
            "Widget is essential for growth in modern SMEs. " * 50
            + "\n\n## First section about widget\n\n"
            + "More on widget here for your business. " * 120
            + "\n\n## Second section on widget strategy\n\n"
            + "Still discussing widget implementation details. " * 120
            + "\n\n## Third section and conclusion\n\n"
            + "In conclusion, widget drives outcomes for teams. Contact us today to get started."
        ),
        word_count=0,
        keywords_used=["widget"],
        internal_links=[],
        generated_at=datetime.now(timezone.utc),
    )
    defaults.update(kwargs)
    return GeneratedPost(**defaults)  # type: ignore[arg-type]


def test_gate_passes_minimal_valid_post() -> None:
    post = _post()
    post.word_count = word_count_body(post.body_markdown)
    gr = run_gate(post, _brief(), _cfg(), published_titles_slugs=[])
    assert gr.result == "PASS"
    assert not gr.hard_failures


def test_gate_fails_low_word_count() -> None:
    body = "## A\n\n" + "short " * 30  # far below 600 words
    post = _post(body_markdown=body, title="widget overview for you")
    gr = run_gate(post, _brief(), _cfg(), [])
    assert gr.result == "FAIL"
    assert any("minimum_word_count" in x for x in gr.hard_failures)


def test_gate_fails_missing_keyword_in_title() -> None:
    post = _post(title="Something unrelated completely")
    post.word_count = word_count_body(post.body_markdown)
    gr = run_gate(post, _brief(), _cfg(), [])
    assert gr.result == "FAIL"
    assert any("target_keyword_not_in_title" in x for x in gr.hard_failures)


def test_similarity_duplicate_title() -> None:
    post = _post(title="Amazing widget guide for teams")
    post.word_count = word_count_body(post.body_markdown)
    published = [("Amazing widget guide for teams!", "other-slug")]
    gr = run_gate(post, _brief(), _cfg(), published)
    assert similarity_ratio(post.title, published[0][0]) > 0.85
    assert gr.result == "FAIL"


def test_meta_description_too_long() -> None:
    long_meta = "x" * 161
    post = _post(meta_description=long_meta)
    post.word_count = word_count_body(post.body_markdown)
    gr = run_gate(post, _brief(), _cfg(), [])
    assert gr.result == "FAIL"
    assert any("meta_description_length" in x for x in gr.hard_failures)
