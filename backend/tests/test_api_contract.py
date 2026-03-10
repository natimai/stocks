from fastapi.testclient import TestClient

from app import app
from core.auth import verify_token_and_check_limit
from routers import stocks


def _dummy_user_context():
    class _UserRef:
        def update(self, *_args, **_kwargs):
            return None

    return {"uid": "test-user", "isPro": True, "analysisCount": 0, "user_ref": _UserRef()}


def test_healthz_contract():
    with TestClient(app) as client:
        response = client.get("/healthz")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
    assert response.headers.get("x-request-id")


def test_quick_stats_contract_includes_metadata(monkeypatch):
    mock_payload = {
        "ticker": "AAPL",
        "name": "Apple Inc.",
        "price": 200.0,
        "changePercent": 1.2,
        "chartData": [{"date": "03/10", "close": 200.0}],
    }
    monkeypatch.setattr(
        stocks,
        "get_quick_stats_cached",
        lambda _ticker: (dict(mock_payload), {"cached": True, "stale": False}),
    )

    with TestClient(app) as client:
        response = client.get("/api/quick-stats/AAPL")

    body = response.json()
    assert response.status_code == 200
    assert body["ticker"] == "AAPL"
    assert "metadata" in body
    assert body["metadata"]["cached"] is True
    assert "latencyMs" in body["metadata"]
    assert response.headers.get("x-request-id")


def test_chart_contract_has_cache_headers(monkeypatch):
    monkeypatch.setattr(
        stocks,
        "get_chart_cached",
        lambda _ticker, _period, _interval: (
            [{"time": 1710000000, "close": 123.45, "open": 120.0, "high": 124.0, "low": 119.0, "volume": 100}],
            {"cached": True, "stale": False},
        ),
    )

    with TestClient(app) as client:
        response = client.get("/api/chart/AAPL", params={"period": "1mo", "interval": "1d"})

    assert response.status_code == 200
    assert isinstance(response.json(), list)
    assert response.headers.get("x-cache-status") == "HIT"
    assert response.headers.get("x-cache-stale") == "false"
    assert response.headers.get("x-request-id")


def test_search_contract(monkeypatch):
    monkeypatch.setattr(
        stocks,
        "search_tickers_cached",
        lambda _q: ([{"symbol": "AAPL", "name": "Apple Inc.", "exchange": "NMS"}], {"cached": False, "stale": False}),
    )

    with TestClient(app) as client:
        response = client.get("/api/search", params={"q": "AAPL"})

    assert response.status_code == 200
    body = response.json()
    assert isinstance(body, list) and body[0]["symbol"] == "AAPL"
    assert response.headers.get("x-cache-status") == "MISS"
    assert response.headers.get("x-request-id")


def test_invalid_ticker_error_shape():
    with TestClient(app) as client:
        response = client.get("/api/quick-stats/THIS_TICKER_IS_TOO_LONG")

    body = response.json()
    assert response.status_code == 400
    assert body["error"]["code"] == "INVALID_TICKER"
    assert body["requestId"]
    assert response.headers.get("x-request-id")


def test_analyze_invalid_ticker_contract():
    app.dependency_overrides[verify_token_and_check_limit] = _dummy_user_context
    try:
        with TestClient(app) as client:
            response = client.get("/api/analyze/THIS_TICKER_IS_TOO_LONG")
    finally:
        app.dependency_overrides.pop(verify_token_and_check_limit, None)

    body = response.json()
    assert response.status_code == 400
    assert body["error"]["code"] == "INVALID_TICKER"
    assert body["requestId"]
