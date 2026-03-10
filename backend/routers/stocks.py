import time
from typing import Optional

from fastapi import APIRouter, Depends, Query, Request, Response
from fastapi.responses import StreamingResponse
from firebase_admin import firestore

from analysis_engine import analyze_stock_stream
from core.auth import verify_token_and_check_limit
from core.config import settings
from core.errors import ApiError
from core.logger import log_event
from core.rate_limit import enforce_rate_limit
from services.market_service import (
    get_chart_cached,
    get_quick_stats_cached,
    search_tickers_cached,
)
from services.portfolio_service import ChatAgentRequest, chat_with_selected_agent

router = APIRouter(tags=["stocks"])


@router.get("/api/analyze/{ticker}")
async def get_stock_analysis(
    ticker: str,
    request: Request,
    date: Optional[str] = Query(default=None),
    user_data: dict = Depends(verify_token_and_check_limit),
):
    started = time.perf_counter()
    if not ticker or len(ticker) > 10:
        raise ApiError(status_code=400, code="INVALID_TICKER", message="Invalid ticker symbol provided")

    enforce_rate_limit(
        key=f"analyze:{user_data['uid']}",
        limit=settings.rate_limit_analyze,
        window_seconds=settings.rate_limit_window_seconds,
        scope="analyze",
    )

    if not user_data.get("isPro"):
        user_data["user_ref"].update({"analysisCount": firestore.Increment(1)})

    log_event(
        "info",
        "analysis.started",
        endpoint="/api/analyze/{ticker}",
        userId=user_data.get("uid"),
        ticker=ticker.upper(),
        provider="gemini+yfinance",
        latencyMs=round((time.perf_counter() - started) * 1000, 2),
    )
    stream = analyze_stock_stream(ticker, date)
    return StreamingResponse(stream, media_type="text/event-stream")


@router.get("/api/chart/{ticker}")
def get_chart(
    ticker: str,
    response: Response,
    period: str = Query("1mo"),
    interval: str = Query("1d"),
):
    started = time.perf_counter()
    if not ticker or len(ticker) > 10:
        raise ApiError(status_code=400, code="INVALID_TICKER", message="Invalid ticker symbol provided")

    data, cache_meta = get_chart_cached(ticker, period, interval)
    response.headers["X-Cache-Status"] = "HIT" if cache_meta.get("cached") else "MISS"
    response.headers["X-Cache-Stale"] = str(bool(cache_meta.get("stale"))).lower()
    log_event(
        "info",
        "chart.fetched",
        endpoint="/api/chart/{ticker}",
        userId=None,
        ticker=ticker.upper(),
        provider="yfinance",
        latencyMs=round((time.perf_counter() - started) * 1000, 2),
        cached=bool(cache_meta.get("cached")),
        stale=bool(cache_meta.get("stale")),
    )
    return data


@router.post("/api/chat_agent")
async def chat_agent(request_body: ChatAgentRequest, request: Request, user_data: dict = Depends(verify_token_and_check_limit)):
    started = time.perf_counter()
    enforce_rate_limit(
        key=f"chat:{user_data['uid']}",
        limit=settings.rate_limit_chat,
        window_seconds=settings.rate_limit_window_seconds,
        scope="chat_agent",
    )
    result = await chat_with_selected_agent(request_body)
    log_event(
        "info",
        "chat_agent.completed",
        endpoint="/api/chat_agent",
        userId=user_data.get("uid"),
        ticker=(request_body.ticker or "").upper(),
        provider="gemini",
        latencyMs=round((time.perf_counter() - started) * 1000, 2),
    )
    return result


@router.get("/api/search")
def search_tickers(q: str = Query(..., min_length=1), response: Response = None):
    started = time.perf_counter()
    data, cache_meta = search_tickers_cached(q)
    if response is not None:
        response.headers["X-Cache-Status"] = "HIT" if cache_meta.get("cached") else "MISS"
        response.headers["X-Cache-Stale"] = str(bool(cache_meta.get("stale"))).lower()
    log_event(
        "info",
        "search.completed",
        endpoint="/api/search",
        userId=None,
        ticker=q.upper(),
        provider="yahoo",
        latencyMs=round((time.perf_counter() - started) * 1000, 2),
        cached=bool(cache_meta.get("cached")),
        stale=bool(cache_meta.get("stale")),
    )
    return data


@router.get("/api/quick-stats/{ticker}")
def get_quick_stats(ticker: str):
    if not ticker or len(ticker) > 10:
        raise ApiError(status_code=400, code="INVALID_TICKER", message="Invalid ticker symbol provided")

    started = time.perf_counter()
    payload, cache_meta = get_quick_stats_cached(ticker)
    latency_ms = round((time.perf_counter() - started) * 1000, 2)

    if isinstance(payload, dict):
        metadata = payload.get("metadata") if isinstance(payload.get("metadata"), dict) else {}
        metadata.update(
            {
                "cached": bool(cache_meta.get("cached")),
                "stale": bool(cache_meta.get("stale")),
                "latencyMs": latency_ms,
            }
        )
        payload["metadata"] = metadata
    log_event(
        "info",
        "quick_stats.completed",
        endpoint="/api/quick-stats/{ticker}",
        userId=None,
        ticker=ticker.upper(),
        provider="yfinance",
        latencyMs=latency_ms,
        cached=bool(cache_meta.get("cached")),
        stale=bool(cache_meta.get("stale")),
    )
    return payload
