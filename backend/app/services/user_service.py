"""User registration, lookup, profile updates, and directory search."""

from __future__ import annotations

import uuid

from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.security import hash_password, verify_password
from app.models import User
from app.schemas.user import UserUpdate


class EmailAlreadyRegistered(Exception):
    pass


async def get_by_id(db: AsyncSession, user_id: uuid.UUID) -> User | None:
    return await db.get(User, user_id)


async def get_by_email(db: AsyncSession, email: str) -> User | None:
    result = await db.execute(
        select(User).where(func.lower(User.email) == email.strip().lower())
    )
    return result.scalar_one_or_none()


async def get_many(db: AsyncSession, user_ids: list[uuid.UUID]) -> list[User]:
    if not user_ids:
        return []
    result = await db.execute(select(User).where(User.id.in_(user_ids)))
    return list(result.scalars().all())


async def register(db: AsyncSession, name: str, email: str, password: str) -> User:
    normalized = email.strip().lower()
    if await get_by_email(db, normalized) is not None:
        raise EmailAlreadyRegistered(normalized)

    user = User(
        name=name.strip(),
        email=normalized,
        password_hash=hash_password(password),
    )
    db.add(user)
    try:
        await db.commit()
    except IntegrityError as exc:
        # Two concurrent registrations for the same address: the unique index
        # is the real arbiter, the check above is just for a nicer error.
        await db.rollback()
        raise EmailAlreadyRegistered(normalized) from exc
    await db.refresh(user)
    return user


async def authenticate(db: AsyncSession, email: str, password: str) -> User | None:
    user = await get_by_email(db, email)
    if user is None:
        return None
    if not verify_password(password, user.password_hash):
        return None
    return user


async def update_profile(db: AsyncSession, user: User, payload: UserUpdate) -> User:
    # exclude_unset so omitting a field leaves it alone, while explicitly
    # sending null clears it.
    changes = payload.model_dump(exclude_unset=True)
    if "name" in changes and changes["name"] is not None:
        changes["name"] = changes["name"].strip()

    for field, value in changes.items():
        setattr(user, field, value)

    await db.commit()
    await db.refresh(user)
    return user


async def search(
    db: AsyncSession, requester: User, query: str, limit: int = 20
) -> list[User]:
    """Find other users by partial name or exact email.

    Email is matched exactly on purpose: it is enough to look up someone whose
    address you know, without turning the endpoint into an address harvester.
    `UserPublic` never returns the email either.
    """
    term = query.strip()
    if len(term) < 2:
        return []

    result = await db.execute(
        select(User)
        .where(
            User.id != requester.id,
            or_(
                User.name.ilike(f"%{term}%"),
                func.lower(User.email) == term.lower(),
            ),
        )
        .order_by(User.name)
        .limit(limit)
    )
    return list(result.scalars().all())
