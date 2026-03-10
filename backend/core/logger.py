import json
import logging
from datetime import datetime, timezone
from typing import Any


_logger = logging.getLogger("stocks-api")
if not _logger.handlers:
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter("%(message)s"))
    _logger.addHandler(handler)
_logger.setLevel(logging.INFO)
_logger.propagate = False


def _to_level(level: str) -> int:
    level_name = (level or "INFO").upper()
    return getattr(logging, level_name, logging.INFO)


def log_event(level: str, message: str, **fields: Any) -> None:
    payload = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "level": (level or "INFO").upper(),
        "message": message,
        **fields,
    }
    _logger.log(_to_level(level), json.dumps(payload, default=str, ensure_ascii=True))
