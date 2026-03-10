import threading
import time
from dataclasses import dataclass
from typing import Any, Callable, Dict, Optional, Tuple

from core.logger import log_event


@dataclass
class CacheEntry:
    value: Any
    fresh_until: float
    stale_until: float


class SWRCache:
    def __init__(self) -> None:
        self._entries: Dict[str, CacheEntry] = {}
        self._inflight: Dict[str, threading.Event] = {}
        self._lock = threading.Lock()

    def _set_entry(self, key: str, value: Any, ttl_seconds: int, swr_seconds: int) -> None:
        now = time.time()
        self._entries[key] = CacheEntry(
            value=value,
            fresh_until=now + max(1, ttl_seconds),
            stale_until=now + max(1, ttl_seconds + swr_seconds),
        )

    def _refresh_in_background(self, key: str, fetcher: Callable[[], Any], ttl_seconds: int, swr_seconds: int) -> None:
        def _worker() -> None:
            try:
                value = fetcher()
                with self._lock:
                    self._set_entry(key, value, ttl_seconds, swr_seconds)
                log_event("info", "cache.background_refresh_ok", cacheKey=key)
            except Exception as exc:
                log_event(
                    "warning",
                    "cache.background_refresh_failed",
                    cacheKey=key,
                    errorType=type(exc).__name__,
                    errorMessage=str(exc),
                )
            finally:
                with self._lock:
                    event = self._inflight.pop(key, None)
                    if event:
                        event.set()

        thread = threading.Thread(target=_worker, daemon=True)
        thread.start()

    def get_or_fetch(
        self,
        key: str,
        fetcher: Callable[[], Any],
        ttl_seconds: int,
        swr_seconds: int,
    ) -> Tuple[Any, Dict[str, Any]]:
        now = time.time()
        wait_event: Optional[threading.Event] = None
        refresh_in_background = False

        with self._lock:
            entry = self._entries.get(key)
            if entry and entry.fresh_until > now:
                return entry.value, {"cached": True, "stale": False}

            if entry and entry.stale_until > now:
                # Return stale immediately and refresh in background once.
                if key not in self._inflight:
                    self._inflight[key] = threading.Event()
                    refresh_in_background = True
                return entry.value, {"cached": True, "stale": True}

            # No usable cache; dedupe in-flight requests.
            if key in self._inflight:
                wait_event = self._inflight[key]
            else:
                self._inflight[key] = threading.Event()

        if refresh_in_background:
            self._refresh_in_background(key, fetcher, ttl_seconds, swr_seconds)
            with self._lock:
                stale_entry = self._entries.get(key)
                return stale_entry.value if stale_entry else None, {"cached": True, "stale": True}

        if wait_event is not None:
            wait_event.wait(timeout=5)
            with self._lock:
                entry = self._entries.get(key)
                if entry:
                    now = time.time()
                    return entry.value, {"cached": True, "stale": entry.fresh_until <= now}

        try:
            value = fetcher()
            with self._lock:
                self._set_entry(key, value, ttl_seconds, swr_seconds)
            return value, {"cached": False, "stale": False}
        except Exception:
            with self._lock:
                stale_entry = self._entries.get(key)
            if stale_entry and stale_entry.stale_until > time.time():
                return stale_entry.value, {"cached": True, "stale": True, "fallback": "stale_on_error"}
            raise
        finally:
            with self._lock:
                event = self._inflight.pop(key, None)
                if event:
                    event.set()


swr_cache = SWRCache()
