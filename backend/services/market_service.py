import json
import os
import time
from typing import Any, Dict, List, Tuple

import httpx
import pandas as pd
import yfinance as yf

from analysis_engine import get_historical_data
from core.budget import record_provider_call
from core.config import settings
from core.errors import ApiError
from core.logger import log_event
from services.cache_store import swr_cache


ANALYSIS_CACHE_DIR = os.path.join(os.path.dirname(__file__), "..", "cache")


def _safe_get(info: Dict[str, Any], key: str, default=None):
    value = info.get(key)
    try:
        if pd.isna(value):
            return default
    except Exception:
        pass
    return default if value is None else value


def _fetch_search_results(query: str) -> List[Dict[str, Any]]:
    url = "https://query2.finance.yahoo.com/v1/finance/search"
    params = {"q": query, "quotesCount": 5, "newsCount": 0}
    headers = {"User-Agent": "Mozilla/5.0"}

    last_error: Exception = None
    for attempt in range(3):
        try:
            record_provider_call("yahoo.search")
            with httpx.Client(timeout=settings.search_timeout_seconds) as client:
                response = client.get(url, params=params, headers=headers)
                response.raise_for_status()
            data = response.json()
            quotes = data.get("quotes", [])
            return [
                {
                    "symbol": q.get("symbol"),
                    "name": q.get("shortname") or q.get("longname") or q.get("symbol"),
                    "exchange": q.get("exchange", "N/A"),
                }
                for q in quotes
                if q.get("symbol")
            ]
        except Exception as exc:
            last_error = exc
            time.sleep(0.3 * (attempt + 1))

    raise ApiError(
        status_code=502,
        code="SEARCH_PROVIDER_FAILED",
        message="Search provider is temporarily unavailable",
        details={"provider": "yahoo", "reason": str(last_error) if last_error else "unknown"},
    )


def search_tickers_cached(query: str) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    cache_key = f"search:{query.upper()}"
    return swr_cache.get_or_fetch(
        cache_key,
        lambda: _fetch_search_results(query),
        ttl_seconds=settings.cache_ttl_seconds_search,
        swr_seconds=settings.cache_swr_seconds_search,
    )


def _fetch_chart_data(ticker: str, period: str, interval: str):
    record_provider_call("yfinance.chart")
    result = get_historical_data(ticker, period, interval)
    if isinstance(result, dict) and "error" in result:
        raise ApiError(
            status_code=502,
            code="CHART_PROVIDER_FAILED",
            message="Chart data provider failed",
            details={"provider": "yfinance", "reason": result.get("error")},
        )
    if not isinstance(result, list):
        raise ApiError(
            status_code=502,
            code="CHART_INVALID_PAYLOAD",
            message="Chart provider returned invalid payload",
            details={"provider": "yfinance"},
        )
    return result


def get_chart_cached(ticker: str, period: str, interval: str):
    key = f"chart:{ticker.upper()}:{period}:{interval}"
    return swr_cache.get_or_fetch(
        key,
        lambda: _fetch_chart_data(ticker, period, interval),
        ttl_seconds=settings.cache_ttl_seconds_chart,
        swr_seconds=settings.cache_swr_seconds_chart,
    )


def _read_cached_analysis_score(ticker: str) -> Tuple[Any, Any]:
    cache_file = os.path.join(ANALYSIS_CACHE_DIR, f"{ticker.upper()}.json")
    if not os.path.exists(cache_file):
        return None, None

    try:
        with open(cache_file, "r", encoding="utf-8") as handle:
            data = json.load(handle)
        return data.get("score"), data.get("recommendation")
    except Exception as exc:
        log_event(
            "warning",
            "quick_stats.cache_read_failed",
            ticker=ticker.upper(),
            errorType=type(exc).__name__,
            errorMessage=str(exc),
        )
        return None, None


def _fetch_quick_stats(ticker: str) -> Dict[str, Any]:
    last_error: Exception = None
    for attempt in range(3):
        try:
            record_provider_call("yfinance.quick_stats")
            stock = yf.Ticker(ticker)
            info = stock.info
            hist = stock.history(period="1mo")

            if hist is None or hist.empty:
                raise ApiError(
                    status_code=502,
                    code="QUICK_STATS_NO_HISTORY",
                    message="No historical data available",
                    details={"ticker": ticker.upper(), "provider": "yfinance"},
                )

            current_price = info.get("currentPrice", 0) or hist["Close"].iloc[-1]
            change_pct = info.get("regularMarketChangePercent", None)

            if change_pct is not None:
                change_pct = change_pct * 100
                if abs(change_pct) > 25 and len(hist) > 1:
                    prev_close = hist["Close"].iloc[-2]
                    change_pct = ((current_price - prev_close) / prev_close) * 100
            elif len(hist) > 1:
                prev_close = hist["Close"].iloc[-2]
                change_pct = ((current_price - prev_close) / prev_close) * 100
            else:
                change_pct = 0.0

            score, recommendation = _read_cached_analysis_score(ticker)

            return {
                "ticker": ticker.upper(),
                "name": info.get("shortName", info.get("longName", ticker.upper())),
                "price": float(current_price) if current_price is not None else 0.0,
                "changePercent": float(change_pct) if change_pct is not None else 0.0,
                "score": score,
                "recommendation": recommendation,
                "market_cap": _safe_get(info, "marketCap", 0),
                "metrics": {
                    "pe_ratio": _safe_get(info, "trailingPE"),
                    "beta": _safe_get(info, "beta"),
                },
                "chartData": [
                    {
                        "date": idx.strftime("%m/%d"),
                        "open": round(float(row["Open"]), 2),
                        "high": round(float(row["High"]), 2),
                        "low": round(float(row["Low"]), 2),
                        "close": round(float(row["Close"]), 2),
                        "volume": int(row["Volume"]) if "Volume" in row else 0,
                    }
                    for idx, row in hist.iterrows()
                ],
            }
        except ApiError:
            raise
        except Exception as exc:
            last_error = exc
            time.sleep(0.35 * (attempt + 1))

    raise ApiError(
        status_code=502,
        code="QUICK_STATS_PROVIDER_FAILED",
        message="Quick stats provider failed",
        details={"provider": "yfinance", "reason": str(last_error) if last_error else "unknown"},
    )


def get_quick_stats_cached(ticker: str):
    key = f"quick_stats:{ticker.upper()}"
    return swr_cache.get_or_fetch(
        key,
        lambda: _fetch_quick_stats(ticker),
        ttl_seconds=settings.cache_ttl_seconds_quick_stats,
        swr_seconds=settings.cache_swr_seconds_quick_stats,
    )
