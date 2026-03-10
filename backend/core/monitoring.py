from .config import settings
from .logger import log_event


def init_monitoring() -> None:
    if not settings.sentry_dsn:
        log_event("info", "monitoring.disabled", reason="missing_sentry_dsn")
        return

    try:
        import sentry_sdk
        from sentry_sdk.integrations.fastapi import FastApiIntegration

        sentry_sdk.init(
            dsn=settings.sentry_dsn,
            traces_sample_rate=settings.sentry_traces_sample_rate,
            integrations=[FastApiIntegration()],
            environment=settings.env,
        )
        log_event(
            "info",
            "monitoring.sentry_enabled",
            environment=settings.env,
            tracesSampleRate=settings.sentry_traces_sample_rate,
        )
    except Exception as exc:
        log_event("warning", "monitoring.sentry_init_failed", errorType=type(exc).__name__, errorMessage=str(exc))
