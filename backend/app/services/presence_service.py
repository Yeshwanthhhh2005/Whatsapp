"""Online / offline bookkeeping, driven entirely by WebSocket lifecycle."""

from __future__ import annotations

import uuid

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import User, utcnow


async def set_online(db: AsyncSession, user_id: uuid.UUID) -> None:
    await db.execute(
        update(User)
        .where(User.id == user_id)
        .values(is_online=True, last_seen=utcnow())
    )
    await db.commit()


async def set_offline(db: AsyncSession, user_id: uuid.UUID) -> None:
    await db.execute(
        update(User)
        .where(User.id == user_id)
        .values(is_online=False, last_seen=utcnow())
    )
    await db.commit()


async def get_last_seen(db: AsyncSession, user_id: uuid.UUID):
    result = await db.execute(select(User.last_seen).where(User.id == user_id))
    return result.scalar_one_or_none()


async def reset_all_offline(db: AsyncSession) -> None:
    """Clear stale `is_online` flags left behind by an unclean shutdown.

    Presence lives in the process (the connection manager); the column is a
    cache of it. On startup there are no connections, so nobody is online.
    """
    await db.execute(
        update(User).where(User.is_online.is_(True)).values(is_online=False)
    )
    await db.commit()
