"""Keyword gap providers (MOCK vs Serper) — Serper calls are mocked."""

from unittest.mock import MagicMock, patch

import pytest

from seo_engine.engine.keywords import fetch_keyword_gaps
from seo_engine.engine.state import ClientConfig


def _minimal_cfg(**kwargs: object) -> ClientConfig:
    base = dict(
        client_id="c1",
        domain="example.com",
        topic_cluster=["Topic Alpha", "Topic Beta"],
        target_audience="SMEs",
        tone="plain",
        publish_destination="LOCAL_MARKDOWN",
        output_dir="./output/c1",
    )
    base.update(kwargs)
    return ClientConfig(**base)


def test_mock_keyword_gaps() -> None:
    cfg = _minimal_cfg(keyword_data_source="MOCK")
    out = fetch_keyword_gaps(cfg)
    assert out["source"] == "MOCK"
    assert len(out["gaps"]) == 2
    assert out["gaps"][0]["intent"] == "informational"


def test_unknown_source_raises() -> None:
    cfg = _minimal_cfg(keyword_data_source="NOT_REAL")
    with pytest.raises(ValueError, match="Unknown keyword_data_source"):
        fetch_keyword_gaps(cfg)


def test_serper_missing_key_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    # Real dev machines often have SERPER_API_KEY in the environment; clear it so this asserts config-only missing key.
    monkeypatch.delenv("SERPER_API_KEY", raising=False)
    cfg = _minimal_cfg(keyword_data_source="SERPER", serper_api_key="")
    with pytest.raises(ValueError, match="no API key"):
        fetch_keyword_gaps(cfg)


def test_serper_uses_http_and_parses_related() -> None:
    cfg = _minimal_cfg(
        keyword_data_source="SERPER",
        serper_api_key="test-key-123",
        topic_cluster=["WhatsApp automation"],
    )
    fake_resp = MagicMock()
    fake_resp.status_code = 200
    fake_resp.text = "{}"
    fake_resp.json.return_value = {
        "relatedSearches": [{"query": "whatsapp business api"}, {"query": "automated replies"}],
        "peopleAlsoAsk": [{"question": "Is WhatsApp Business free?"}],
        "organic": [{"title": "Top guide to WA"}],
    }
    fake_resp.raise_for_status = MagicMock()

    mock_cm = MagicMock()
    mock_cm.post.return_value = fake_resp
    mock_client_instance = MagicMock()
    mock_client_instance.__enter__ = MagicMock(return_value=mock_cm)
    mock_client_instance.__exit__ = MagicMock(return_value=False)

    with patch("seo_engine.engine.keywords.httpx.Client", return_value=mock_client_instance):
        out = fetch_keyword_gaps(cfg)

    assert out["source"] == "SERPER"
    assert len(out["gaps"]) >= 3
    keywords = [g["keyword"] for g in out["gaps"]]
    assert any("whatsapp" in k.lower() for k in keywords)
    mock_cm.post.assert_called()


def test_serper_api_alias_same_as_serper() -> None:
    cfg = _minimal_cfg(
        keyword_data_source="SERPER_API",
        serper_api_key="k",
        topic_cluster=["only one"],
    )
    fake_resp = MagicMock()
    fake_resp.status_code = 200
    fake_resp.text = "{}"
    fake_resp.json.return_value = {"relatedSearches": [{"query": "x"}], "organic": [], "peopleAlsoAsk": []}
    fake_resp.raise_for_status = MagicMock()

    mock_cm = MagicMock()
    mock_cm.post.return_value = fake_resp
    mock_client_instance = MagicMock()
    mock_client_instance.__enter__ = MagicMock(return_value=mock_cm)
    mock_client_instance.__exit__ = MagicMock(return_value=False)

    with patch("seo_engine.engine.keywords.httpx.Client", return_value=mock_client_instance):
        out = fetch_keyword_gaps(cfg)
    assert out["source"] == "SERPER"
    assert out["gaps"]
