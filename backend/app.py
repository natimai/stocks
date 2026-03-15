from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from core.config import settings
from core.errors import register_exception_handlers
from core.firebase_client import init_firebase
from core.logger import log_event
from core.monitoring import init_monitoring
from core.request_context import RequestContextMiddleware
from routers.admin import router as admin_router
from routers.portfolio import router as portfolio_router
from routers.stocks import router as stocks_router
from routers.system import router as system_router
from routers.telemetry import router as telemetry_router
from routers.users import router as users_router


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_firebase()
    log_event(
        "info",
        "app.startup",
        env=settings.env,
        corsOrigins=settings.cors_origins,
        adminClaimKey=settings.admin_claim_key,
    )
    yield


def create_app() -> FastAPI:
    app = FastAPI(
        title="US Stock Analysis API",
        description="Backend for the SaaS fintech dashboard",
        version="2.0.0",
        lifespan=lifespan,
    )

    init_monitoring()

    app.add_middleware(RequestContextMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["X-Request-ID", "X-Response-Time-Ms", "X-Cache-Status", "X-Cache-Stale"],
    )

    register_exception_handlers(app)

    app.include_router(system_router)
    app.include_router(admin_router)
    app.include_router(users_router)
    app.include_router(stocks_router)
    app.include_router(portfolio_router)
    app.include_router(telemetry_router)

    return app


app = create_app()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app:app", host="0.0.0.0", port=8000, reload=True)
