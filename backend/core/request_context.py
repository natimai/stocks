import time
import uuid

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from .logger import log_event


class RequestContextMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        request_id = request.headers.get("X-Request-ID") or str(uuid.uuid4())
        request.state.request_id = request_id
        start = time.perf_counter()

        response: Response = await call_next(request)

        latency_ms = round((time.perf_counter() - start) * 1000, 2)
        response.headers["X-Request-ID"] = request_id
        response.headers["X-Response-Time-Ms"] = str(latency_ms)

        log_event(
            "info",
            "http.request",
            requestId=request_id,
            method=request.method,
            endpoint=request.url.path,
            statusCode=response.status_code,
            latencyMs=latency_ms,
            clientIp=request.client.host if request.client else None,
        )
        return response
