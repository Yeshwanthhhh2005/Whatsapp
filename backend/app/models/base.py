"""Declarative base plus small shared helpers."""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    pass


def utcnow() -> datetime:
    """Timezone-aware UTC now.

    Used for values we set in Python (read receipts, last_seen) so they are
    directly comparable with the TIMESTAMPTZ columns the database fills in.
    """
    return datetime.now(timezone.utc)


def as_aware(value: datetime | None) -> datetime | None:
    """Treat a naive datetime loaded from the database as UTC.

    PostgreSQL TIMESTAMPTZ round-trips the offset, but SQLite -- which the test
    suite uses -- drops it. Normalising on read keeps Python-side comparisons
    from raising "can't compare offset-naive and offset-aware datetimes" on
    one backend while passing on the other.
    """
    if value is None or value.tzinfo is not None:
        return value
    return value.replace(tzinfo=timezone.utc)
