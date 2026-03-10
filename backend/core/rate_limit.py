import threading
import time
from collections import defaultdict, deque
from typing import Deque, Dict, Tuple

from .errors import ApiError


class InMemoryRateLimiter:
    def __init__(self) -> None:
        self._events: Dict[str, Deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def allow(self, key: str, limit: int, window_seconds: int) -> Tuple[bool, int]:
        now = time.time()
        with self._lock:
            q = self._events[key]
            threshold = now - window_seconds
            while q and q[0] <= threshold:
                q.popleft()

            if len(q) >= limit:
                retry_after = max(1, int(window_seconds - (now - q[0])))
                return False, retry_after

            q.append(now)
            return True, 0


rate_limiter = InMemoryRateLimiter()


def enforce_rate_limit(key: str, limit: int, window_seconds: int, scope: str) -> None:
    if limit <= 0:
        return

    allowed, retry_after = rate_limiter.allow(key, limit, window_seconds)
    if not allowed:
        raise ApiError(
            status_code=429,
            code="RATE_LIMITED",
            message="Too many requests. Please retry shortly.",
            details={
                "scope": scope,
                "retryAfterSec": retry_after,
                "limit": limit,
                "windowSec": window_seconds,
            },
        )
