from dataclasses import dataclass
from typing import Any, Dict, Optional

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse

from .logger import log_event


@dataclass
class ApiError(Exception):
    status_code: int
    code: str
    message: str
    details: Optional[Any] = None



def _request_id(request: Request) -> str:
    return getattr(request.state, "request_id", "unknown")



def _error_payload(request: Request, code: str, message: str, details: Optional[Any] = None) -> Dict[str, Any]:
    return {
        "detail": message,
        "error": {
            "code": code,
            "details": details,
        },
        "requestId": _request_id(request),
    }


async def api_error_handler(request: Request, exc: ApiError) -> JSONResponse:
    rid = _request_id(request)
    log_event(
        "warning",
        "api.error",
        requestId=rid,
        endpoint=request.url.path,
        method=request.method,
        errorCode=exc.code,
        statusCode=exc.status_code,
        details=exc.details,
    )
    response = JSONResponse(
        status_code=exc.status_code,
        content=_error_payload(request, exc.code, exc.message, exc.details),
    )
    response.headers["X-Request-ID"] = rid
    return response


async def http_exception_handler(request: Request, exc: HTTPException) -> JSONResponse:
    rid = _request_id(request)
    detail = exc.detail

    if isinstance(detail, dict) and "error" in detail:
        # Keep compatibility if an endpoint already raised an error-like dict.
        payload = dict(detail)
        payload.setdefault("requestId", rid)
        payload.setdefault("detail", payload.get("error", {}).get("message", "Request failed"))
        payload.setdefault("error", {}).setdefault("code", f"HTTP_{exc.status_code}")
    else:
        payload = _error_payload(request, f"HTTP_{exc.status_code}", str(detail), None)

    log_event(
        "warning",
        "http.exception",
        requestId=rid,
        endpoint=request.url.path,
        method=request.method,
        statusCode=exc.status_code,
        errorCode=payload.get("error", {}).get("code", f"HTTP_{exc.status_code}"),
    )

    response = JSONResponse(status_code=exc.status_code, content=payload)
    response.headers["X-Request-ID"] = rid
    return response


async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    rid = _request_id(request)
    log_event(
        "error",
        "unhandled.exception",
        requestId=rid,
        endpoint=request.url.path,
        method=request.method,
        errorType=type(exc).__name__,
        errorMessage=str(exc),
    )
    response = JSONResponse(
        status_code=500,
        content=_error_payload(
            request,
            "INTERNAL_SERVER_ERROR",
            "Unexpected server error",
            {"type": type(exc).__name__},
        ),
    )
    response.headers["X-Request-ID"] = rid
    return response



def register_exception_handlers(app: FastAPI) -> None:
    app.add_exception_handler(ApiError, api_error_handler)
    app.add_exception_handler(HTTPException, http_exception_handler)
    app.add_exception_handler(Exception, unhandled_exception_handler)
