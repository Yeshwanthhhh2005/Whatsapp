"""Async SQLAlchemy engine, session factory, and the FastAPI session dependency.

The engine is built lazily rather than at import time. Async engines are bound
to the event loop that first uses them, and lazy construction keeps imports
side-effect free so tests can point DATABASE_URL somewhere else before the app
ever starts.
"""

from __future__ import annotations

from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.config import get_settings
# Import the package, not just base, so every table is registered on
# Base.metadata before create_all runs.
from app.models import Base

_engine: AsyncEngine | None = None
_session_factory: async_sessionmaker[AsyncSession] | None = None


def get_engine() -> AsyncEngine:
    global _engine
    if _engine is None:
        settings = get_settings()
        kwargs: dict[str, object] = {
            "echo": False,
            "pool_pre_ping": True,
            "future": True,
        }
        if settings.database_url.startswith("sqlite"):
            from sqlalchemy.pool import NullPool, StaticPool

            # aiosqlite drives the connection from a worker thread.
            kwargs["connect_args"] = {
                "check_same_thread": False,
                # Wait rather than fail instantly if another connection holds
                # the write lock.
                "timeout": 30,
            }

            if ":memory:" in settings.database_url:
                # An in-memory database only exists inside its own connection,
                # so every session has to share one.
                kwargs["poolclass"] = StaticPool
            else:
                # A file database must NOT share a single connection. A
                # request and a WebSocket handler each open their own session;
                # on one shared connection their transactions interleave and
                # trample each other -- an INSERT can disappear before the
                # following refresh. NullPool hands out a fresh connection per
                # session instead.
                kwargs["poolclass"] = NullPool
        _engine = create_async_engine(settings.database_url, **kwargs)

        if settings.database_url.startswith("sqlite"):
            from sqlalchemy import event

            @event.listens_for(_engine.sync_engine, "connect")
            def _apply_sqlite_pragmas(dbapi_connection, _record):  # noqa: ANN001
                cursor = dbapi_connection.cursor()
                # WAL lets readers and a writer work at the same time instead
                # of blocking each other, which matters once WebSocket
                # handlers and HTTP requests overlap.
                cursor.execute("PRAGMA journal_mode=WAL")
                cursor.execute("PRAGMA synchronous=NORMAL")
                # SQLite ignores foreign keys unless asked, which would make
                # the ON DELETE CASCADE on our tables silently do nothing.
                cursor.execute("PRAGMA foreign_keys=ON")
                cursor.close()

    return _engine


def get_session_factory() -> async_sessionmaker[AsyncSession]:
    global _session_factory
    if _session_factory is None:
        _session_factory = async_sessionmaker(
            bind=get_engine(),
            expire_on_commit=False,
            autoflush=False,
        )
    return _session_factory


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """FastAPI dependency yielding a session scoped to one request."""
    async with get_session_factory()() as session:
        yield session


async def create_all() -> None:
    """Create every table from the models. Dev/test only — use Alembic for real."""
    async with get_engine().begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def dispose_engine() -> None:
    global _engine, _session_factory
    if _engine is not None:
        await _engine.dispose()
    _engine = None
    _session_factory = None
