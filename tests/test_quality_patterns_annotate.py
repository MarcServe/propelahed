"""Learning list annotation (new-from-article blocks) for UI."""

from seo_engine.engine.stage5_learn import _annotate_new_lines, _annotate_new_quality_patterns


def test_first_article_all_new_gets_header_and_bullets() -> None:
    raw = ["Finding one", "Finding two"]
    out = _annotate_new_quality_patterns(raw, None, "My Post")
    assert out[0].startswith("New from last article")
    assert "My Post" in out[0]
    assert out[1].startswith("▸ ")
    assert "Finding one" in out[1]
    assert out[2].startswith("▸ ")


def test_no_prev_means_all_new() -> None:
    out = _annotate_new_quality_patterns(["only"], [], "T")
    assert len(out) == 2
    assert "▸" in out[1] and "only" in out[1]


def test_nothing_new_returns_raw() -> None:
    raw = ["same line"]
    out = _annotate_new_quality_patterns(raw, ["same line"], "X")
    assert out == ["same line"]


def test_partial_new_only_new_lines_in_group() -> None:
    raw = ["old line repeated", "brand new finding"]
    prev = ["old line repeated"]
    out = _annotate_new_quality_patterns(raw, prev, "Article B")
    assert out[0].startswith("New from last article")
    assert len(out) == 2
    assert "▸" in out[1] and "brand new finding" in out[1]


def test_case_insensitive_dedupe_against_prev() -> None:
    raw = ["Hello World"]
    out = _annotate_new_quality_patterns(raw, ["hello world"], "T")
    assert out == ["Hello World"]


def test_keyword_new_section_respects_max_bullets() -> None:
    raw = [f"kw{i}" for i in range(40)]
    out = _annotate_new_lines(raw, [], "My Article", max_new_bullets=25)
    assert out[0].startswith("New from last article")
    bullets = [x for x in out if x.startswith("▸ ")]
    assert len(bullets) == 25


def test_next_topics_gets_same_new_header_shape() -> None:
    out = _annotate_new_lines(["Topic A", "Topic B"], [], "Run title")
    assert "Run title" in out[0]
    assert out[1].startswith("▸ ") and "Topic A" in out[1]
