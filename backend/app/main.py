"""FastAPI application factory and wiring."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.config import get_settings
from app.database import create_all, dispose_engine, get_session_factory
from app.routes import api_router
from app.services import presence_service
from app.websocket import manager, websocket_router

logger = logging.getLogger(__name__)

DESCRIPTION = """
Backend for a WhatsApp Web-style client: JWT auth, direct and group chats,
message history, file attachments, and real-time delivery over WebSockets.

**Authenticating in this page** - call `POST /api/auth/register` or
`/api/auth/login`, copy `access_token` from the response, then click
**Authorize** and paste it.

**WebSocket** - connect to `ws://localhost:8000/ws/{chat_id}?token=<token>`.
Browsers cannot set headers on a WebSocket handshake, which is why the token
travels in the query string. Frames are `{"event": ..., "data": {...}}` in both
directions; the full event list is in the `app/schemas/ws.py` docstring and the
README.
"""


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    logging.basicConfig(
        level=logging.INFO if settings.is_production else logging.DEBUG,
        format="%(levelname)-8s %(name)s: %(message)s",
    )
    # aiosqlite logs two DEBUG lines per statement, which buries everything
    # else in development. Our own loggers keep the configured level.
    for noisy in ("aiosqlite", "asyncio", "multipart"):
        logging.getLogger(noisy).setLevel(logging.WARNING)

    settings.upload_path.mkdir(parents=True, exist_ok=True)

    if settings.auto_create_tables:
        logger.warning(
            "AUTO_CREATE_TABLES is on: creating tables from the models and "
            "bypassing Alembic. Fine for dev and tests, not for production."
        )
        await create_all()

    # is_online is a cache of in-process connection state, so a restart means
    # nobody is connected. Clear flags a previous crash may have left set.
    try:
        async with get_session_factory()() as db:
            await presence_service.reset_all_offline(db)
    except Exception:  # noqa: BLE001 - never block startup on this
        logger.warning("Could not reset presence flags on startup", exc_info=True)

    yield

    await manager.close_all()
    await dispose_engine()


def create_app() -> FastAPI:
    settings = get_settings()

    app = FastAPI(
        title=settings.app_name,
        description=DESCRIPTION,
        version="1.0.0",
        lifespan=lifespan,
        docs_url="/docs",
        redoc_url="/redoc",
        openapi_url="/openapi.json",
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        # Credentials are sent as a bearer token, not a cookie, but this keeps
        # the door open for a cookie-based session later without surprises.
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(api_router)
    # Not under /api: a WebSocket route, matching the /ws/{chat_id} spec.
    app.include_router(websocket_router)

    # Serves uploaded attachments. Swap for a CDN/S3 origin when storage moves.
    settings.upload_path.mkdir(parents=True, exist_ok=True)
    app.mount(
        "/uploads",
        StaticFiles(directory=settings.upload_path),
        name="uploads",
    )

    @app.get("/api/health", tags=["meta"], summary="Liveness probe")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    return app


app = create_app()
