from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class UserPublic(BaseModel):
    """What one user may see about another.

    Deliberately omits `email`: user search matches on email but never returns
    it, so knowing someone's address lets you find them while nobody can
    harvest addresses out of the directory.
    """

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    profile_image: str | None = None
    about: str | None = None
    is_online: bool = False
    last_seen: datetime | None = None


class UserMe(UserPublic):
    """The authenticated user's own record, which does include the email."""

    email: EmailStr
    created_at: datetime


class UserSearchResult(UserPublic):
    """A directory hit, which *does* carry the email.

    Two people can register the same display name, and then a search for
    "apple" returns several identical-looking rows -- pick the wrong one and
    you appear to be chatting with yourself. The email is the only thing that
    tells them apart, so it is included here and nowhere else: chat members and
    message senders still use plain `UserPublic`.

    The trade-off is deliberate. Search needs at least two characters and is
    capped, so this is a lookup tool rather than a bulk export, but it does
    mean a signed-in user can discover the address of someone whose name they
    can guess. On a private deployment that would want revisiting.
    """

    email: EmailStr


class UserUpdate(BaseModel):
    """PATCH /api/users/me. Every field is optional; omitted fields are left alone."""

    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=80)
    about: str | None = Field(default=None, max_length=160)
    profile_image: str | None = Field(default=None, max_length=512)
