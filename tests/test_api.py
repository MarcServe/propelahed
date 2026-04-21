from fastapi.testclient import TestClient

from seo_engine.api.app import create_app


def test_list_clients_includes_talkweb() -> None:
    app = create_app()
    client = TestClient(app)
    r = client.get("/api/clients")
    assert r.status_code == 200
    data = r.json()
    ids = {row["client_id"] for row in data}
    assert "talkweb" in ids


def test_put_config_invalid_yaml_returns_400() -> None:
    app = create_app()
    client = TestClient(app)
    r = client.put(
        "/api/clients/talkweb/config",
        json={"yaml": "client_id: [\n  broken"},
    )
    assert r.status_code == 400


def test_put_config_missing_required_field_returns_400() -> None:
    app = create_app()
    client = TestClient(app)
    r = client.put(
        "/api/clients/talkweb/config",
        json={"yaml": "client_id: talkweb\n"},
    )
    assert r.status_code == 400


def test_research_context_ok() -> None:
    app = create_app()
    client = TestClient(app)
    r = client.get("/api/clients/talkweb/research-context")
    assert r.status_code == 200
    data = r.json()
    assert data["client_id"] == "talkweb"
    assert "topic_cluster" in data
    assert "keyword_gaps" in data


def test_list_runs_ok() -> None:
    app = create_app()
    client = TestClient(app)
    r = client.get("/api/clients/talkweb/runs?limit=5")
    assert r.status_code == 200
    assert isinstance(r.json(), list)


def test_run_options_ok() -> None:
    app = create_app()
    client = TestClient(app)
    r = client.get("/api/clients/talkweb/run-options")
    assert r.status_code == 200
    data = r.json()
    assert data["client_id"] == "talkweb"
    assert "candidates" in data
    assert isinstance(data["candidates"], list)
    assert "target_word_count" in data


def test_run_manual_empty_keyword_returns_400() -> None:
    app = create_app()
    client = TestClient(app)
    r = client.post(
        "/api/clients/talkweb/run",
        json={"mode": "manual", "target_keyword": "   "},
    )
    assert r.status_code == 400


def test_run_auto_returns_job() -> None:
    app = create_app()
    client = TestClient(app)
    r = client.post("/api/clients/talkweb/run", json={"mode": "auto"})
    assert r.status_code == 200
    data = r.json()
    assert "job_id" in data


def test_research_hint_history_ok() -> None:
    app = create_app()
    client = TestClient(app)
    r = client.get("/api/clients/talkweb/research-hint-history")
    assert r.status_code == 200
    assert isinstance(r.json(), list)


def test_put_research_hint_appends_dashboard_snapshot() -> None:
    app = create_app()
    client = TestClient(app)
    marker = "api-test snapshot text ce7f2a9b"
    r_put = client.put("/api/clients/talkweb/research-hint", json={"hint": marker})
    assert r_put.status_code == 200
    r_hist = client.get("/api/clients/talkweb/research-hint-history?limit=5")
    assert r_hist.status_code == 200
    rows = r_hist.json()
    assert isinstance(rows, list) and len(rows) >= 1
    newest = rows[0]
    assert newest.get("hint_text") == marker
    assert str(newest.get("loop_id", "")).startswith("dashboard-save-")


def test_article_download_unknown_article_returns_404() -> None:
    app = create_app()
    client = TestClient(app)
    r = client.get("/api/clients/talkweb/articles/999999999/download")
    assert r.status_code == 404


def test_delete_loop_run_missing_returns_404() -> None:
    app = create_app()
    client = TestClient(app)
    r = client.delete("/api/clients/talkweb/runs/999999999")
    assert r.status_code == 404


def test_delete_article_missing_returns_404() -> None:
    app = create_app()
    client = TestClient(app)
    r = client.delete("/api/clients/talkweb/articles/999999999")
    assert r.status_code == 404


def test_delete_evaluation_missing_returns_404() -> None:
    app = create_app()
    client = TestClient(app)
    r = client.delete("/api/clients/talkweb/evaluations/999999999")
    assert r.status_code == 404
