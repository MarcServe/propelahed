"""Internal link resolution and scoring."""

from seo_engine.engine.internal_links import (
    body_has_internal_link_signal,
    internal_link_targets_for_scoring,
    resolve_link_placeholders,
    score_internal_linking_body,
    slug_title_map_from_articles,
)
from seo_engine.engine.state import ClientConfig


def _cfg(**kwargs: object) -> ClientConfig:
    base = dict(
        client_id="c1",
        domain="example.com",
        topic_cluster=["t"],
        target_audience="x",
        tone="plain",
        publish_destination="LOCAL_MARKDOWN",
        output_dir="./out",
    )
    base.update(kwargs)
    return ClientConfig(**base)


def test_resolve_placeholder_to_markdown_url() -> None:
    cfg = _cfg()
    body = "See also [LINK: pricing] for details."
    slug_map = {"pricing": "Pricing & plans"}
    out = resolve_link_placeholders(body, cfg, slug_map)
    assert "[LINK:" not in out
    assert "](https://example.com/pricing)" in out
    assert "Pricing & plans" in out


def test_resolve_uses_path_prefix() -> None:
    cfg = _cfg(url_path_prefix="/blog")
    out = resolve_link_placeholders("x [LINK: a] y", cfg, {"a": "A"})
    assert "https://example.com/blog/a" in out


def test_body_has_internal_link_markdown() -> None:
    cfg = _cfg()
    assert body_has_internal_link_signal("[x](https://example.com/foo)", cfg) is True
    assert body_has_internal_link_signal("no links", cfg) is False


def test_score_distinct_targets() -> None:
    cfg = _cfg()
    b = "[LINK: a] [LINK: b]"
    assert score_internal_linking_body(b, cfg) == 10.0
    assert score_internal_linking_body("[LINK: a]", cfg) == 5.0
    md = "[A](https://example.com/x) [B](https://example.com/y)"
    assert score_internal_linking_body(md, cfg) == 10.0


def test_internal_link_targets_from_markdown() -> None:
    cfg = _cfg(url_path_prefix="/blog")
    body = "[T](https://example.com/blog/z)"
    t = internal_link_targets_for_scoring(body, cfg)
    assert "z" in t


def test_slug_map_from_rows() -> None:
    m = slug_title_map_from_articles([{"slug": "Foo-Bar", "title": "Foo Bar Title"}])
    assert m["foo-bar"] == "Foo Bar Title"
