from fastapi import APIRouter

from core.config import settings

router = APIRouter()


@router.get("/")
def read_root():
    return {
        "message": "Welcome to the SaaS Stock Analysis API. Use /api/analyze/{ticker} to get real-time scores.",
        "env": settings.env,
    }


@router.get("/healthz")
def healthz():
    return {"status": "ok"}
