from typing import Any, Dict, Optional

from fastapi import APIRouter, Request
from pydantic import BaseModel

from core.logger import log_event
from core.rate_limit import enforce_rate_limit

router = APIRouter(tags=["telemetry"])


class ClientErrorPayload(BaseModel):
    message: str
    stack: Optional[str] = None
    url: Optional[str] = None
    userAgent: Optional[str] = None
    context: Optional[Dict[str, Any]] = None


@router.post("/api/client-errors")
def ingest_client_error(payload: ClientErrorPayload, request: Request):
    client_ip = request.client.host if request.client else "unknown"
    enforce_rate_limit(key=f"client_error:{client_ip}", limit=30, window_seconds=60, scope="client_error")

    log_event(
        "error",
        "client.error",
        requestId=getattr(request.state, "request_id", "unknown"),
        clientIp=client_ip,
        message=payload.message,
        stack=payload.stack,
        url=payload.url,
        userAgent=payload.userAgent,
        context=payload.context,
    )
    return {"ok": True}
