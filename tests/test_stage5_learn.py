"""Learning delta helpers for stage 5 (no LLM / DB)."""

from typing import Any

from seo_engine.engine.state import ContentBrief, EvaluationResult
from seo_engine.engine.stage5_learn import _derive_do_not_repeat


def _brief(*, angle: str = "") -> ContentBrief:
    return ContentBrief(
        target_keyword="voice ai smes",
        secondary_keywords=[],
        title_suggestion="Title",
        angle=angle,
        target_word_count=1200,
        audience_note="UK SMEs",
        internal_link_candidates=[],
        avoid_topics=[],
        rationale="test",
    )


def _ev(**kwargs: Any) -> EvaluationResult:
    base: dict[str, Any] = {
        "overall_score": 78.0,
        "semantic_coverage": 20.0,
        "keyword_usage": 20.0,
        "readability": 16.0,
        "structural_completeness": 16.0,
        "internal_linking": 8.0,
        "findings": [],
        "flags": [],
    }
    base.update(kwargs)
    return EvaluationResult(**base)


def test_derive_do_not_repeat_empty_when_all_dimensions_strong() -> None:
    assert _derive_do_not_repeat(_ev(), _brief()) == []


def test_derive_do_not_repeat_flags_only() -> None:
    out = _derive_do_not_repeat(_ev(flags=["underperforming_overall_score"]), _brief())
    assert out == ["underperforming_overall_score"]


def test_derive_do_not_repeat_weak_readability() -> None:
    out = _derive_do_not_repeat(_ev(readability=10.0), _brief())
    assert len(out) == 1
    assert "readability" in out[0].lower()


def test_derive_do_not_repeat_low_overall_includes_angle_line() -> None:
    out = _derive_do_not_repeat(
        _ev(overall_score=50.0, semantic_coverage=22.0, keyword_usage=22.0, readability=18.0, structural_completeness=18.0, internal_linking=9.0),
        _brief(angle="Take a contrarian angle on pricing."),
    )
    assert any("Low score angle" in x for x in out)
    assert any("pricing" in x for x in out)


def test_derive_do_not_repeat_dedupes() -> None:
    ev = EvaluationResult(
        overall_score=50.0,
        semantic_coverage=10.0,
        keyword_usage=10.0,
        readability=10.0,
        structural_completeness=10.0,
        internal_linking=0.0,
        findings=[],
        flags=["underperforming_overall_score"],
    )
    out = _derive_do_not_repeat(ev, _brief(angle="x"))
    assert len(out) == len(set(x.lower() for x in out))
