import threading
import time
from collections import defaultdict, deque
from typing import Deque, Dict

from .config import settings
from .logger import log_event


class SlidingWindowCounter:
    def __init__(self) -> None:
        self._events: Dict[str, Deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def add_and_count(self, key: str, window_seconds: int) -> int:
        now = time.time()
        with self._lock:
            events = self._events[key]
            threshold = now - window_seconds
            while events and events[0] <= threshold:
                events.popleft()
            events.append(now)
            return len(events)


_counter = SlidingWindowCounter()
_last_alert: Dict[str, float] = {}
_ALERT_COOLDOWN_SECONDS = 30


def _should_alert(key: str) -> bool:
    now = time.time()
    last = _last_alert.get(key, 0)
    if now - last < _ALERT_COOLDOWN_SECONDS:
        return False
    _last_alert[key] = now
    return True


def _record(kind: str, name: str, limit_per_minute: int) -> None:
    if limit_per_minute <= 0:
        return

    key = f"{kind}:{name}"
    count = _counter.add_and_count(key, window_seconds=60)
    if count > limit_per_minute and _should_alert(key):
        log_event(
            "warning",
            "budget.threshold_exceeded",
            budgetType=kind,
            resource=name,
            countLastMinute=count,
            limitPerMinute=limit_per_minute,
        )


def record_provider_call(name: str) -> None:
    _record("provider", name, settings.provider_budget_calls_per_minute)


def record_llm_call(name: str) -> None:
    _record("llm", name, settings.llm_budget_calls_per_minute)
