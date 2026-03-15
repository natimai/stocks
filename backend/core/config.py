import os
from dataclasses import dataclass
from typing import List, Set

from dotenv import load_dotenv


load_dotenv()


def _parse_csv(value: str, default: List[str]) -> List[str]:
    if not value:
        return default
    items = [item.strip() for item in value.split(',') if item.strip()]
    return items or default


def _parse_int(value: str, default: int) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _parse_float(value: str, default: float) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


@dataclass(frozen=True)
class Settings:
    env: str
    cors_origins: List[str]
    admin_emails: Set[str]
    admin_claim_key: str
    gemini_model: str
    firebase_credentials_file: str
    request_timeout_seconds: float
    search_timeout_seconds: float
    sentry_dsn: str
    sentry_traces_sample_rate: float
    rate_limit_window_seconds: int
    rate_limit_analyze: int
    rate_limit_chat: int
    rate_limit_portfolio_doctor: int
    cache_ttl_seconds_quick_stats: int
    cache_ttl_seconds_chart: int
    cache_ttl_seconds_search: int
    cache_swr_seconds_quick_stats: int
    cache_swr_seconds_chart: int
    cache_swr_seconds_search: int
    provider_budget_calls_per_minute: int
    llm_budget_calls_per_minute: int


def _build_settings() -> Settings:
    default_origins = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ]

    admin_emails = set(
        _parse_csv(
            os.getenv("ADMIN_EMAILS", ""),
            [],
        )
    )

    return Settings(
        env=os.getenv("APP_ENV", "development"),
        cors_origins=_parse_csv(os.getenv("ALLOWED_ORIGINS", ""), default_origins),
        admin_emails=admin_emails,
        admin_claim_key=os.getenv("ADMIN_CLAIM_KEY", "admin"),
        gemini_model=os.getenv("GEMINI_MODEL", "gemini-2.5-pro"),
        firebase_credentials_file=os.getenv("FIREBASE_CREDENTIALS_FILE", "firebase-credentials.json"),
        request_timeout_seconds=_parse_float(os.getenv("REQUEST_TIMEOUT_SECONDS"), 20.0),
        search_timeout_seconds=_parse_float(os.getenv("SEARCH_TIMEOUT_SECONDS"), 7.5),
        sentry_dsn=os.getenv("SENTRY_DSN", ""),
        sentry_traces_sample_rate=_parse_float(os.getenv("SENTRY_TRACES_SAMPLE_RATE"), 0.1),
        rate_limit_window_seconds=_parse_int(os.getenv("RATE_LIMIT_WINDOW_SECONDS"), 60),
        rate_limit_analyze=_parse_int(os.getenv("RATE_LIMIT_ANALYZE_PER_WINDOW"), 6),
        rate_limit_chat=_parse_int(os.getenv("RATE_LIMIT_CHAT_PER_WINDOW"), 20),
        rate_limit_portfolio_doctor=_parse_int(os.getenv("RATE_LIMIT_PORTFOLIO_DOCTOR_PER_WINDOW"), 12),
        cache_ttl_seconds_quick_stats=_parse_int(os.getenv("CACHE_TTL_QUICK_STATS_SECONDS"), 60),
        cache_ttl_seconds_chart=_parse_int(os.getenv("CACHE_TTL_CHART_SECONDS"), 45),
        cache_ttl_seconds_search=_parse_int(os.getenv("CACHE_TTL_SEARCH_SECONDS"), 120),
        cache_swr_seconds_quick_stats=_parse_int(os.getenv("CACHE_SWR_QUICK_STATS_SECONDS"), 240),
        cache_swr_seconds_chart=_parse_int(os.getenv("CACHE_SWR_CHART_SECONDS"), 180),
        cache_swr_seconds_search=_parse_int(os.getenv("CACHE_SWR_SEARCH_SECONDS"), 300),
        provider_budget_calls_per_minute=_parse_int(os.getenv("PROVIDER_BUDGET_CALLS_PER_MINUTE"), 600),
        llm_budget_calls_per_minute=_parse_int(os.getenv("LLM_BUDGET_CALLS_PER_MINUTE"), 120),
    )


settings = _build_settings()
