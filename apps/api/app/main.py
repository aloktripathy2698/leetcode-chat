from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import api_router
from app.core.config import settings
from app.core.logging import configure_logging
from app.db.init_db import init_db

configure_logging()

app = FastAPI(
    title=settings.project_name,
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

if settings.cors_origins or settings.cors_origin_regex:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[str(origin) for origin in settings.cors_origins],
        allow_origin_regex=settings.cors_origin_regex,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

app.include_router(api_router, prefix=settings.api_v1_prefix)


@app.get("/healthz", tags=["health"])
async def healthz() -> dict[str, str]:
    """
    Light-weight liveness probe.
    """

    return {"status": "ok"}


@app.on_event("startup")
async def on_startup() -> None:
    await init_db()
