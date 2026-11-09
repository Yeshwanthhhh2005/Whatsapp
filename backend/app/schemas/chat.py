from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.models.conversation import ConversationType
from app.schemas.message import MessageOut
from app.schemas.user import UserPublic

MAX_GROUP_MEMBERS = 256


class ChatMember(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    user: UserPublic
    is_admin: bool = False
    joined_at: datetime


class ChatOut(BaseModel):
    id: uuid.UUID
    type: ConversationType
    is_group: bool
    # For a group this is the stored name; for a direct chat it is the other
    # member's name, resolved per requesting user.
    name: str
    members: list[ChatMember]
    last_message: MessageOut | None = None
    last_message_at: datetime | None = None
    unread_count: int = 0
    created_at: datetime


class ChatCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: ConversationType = ConversationType.direct
    # The caller is added automatically and does not need to be listed.
    member_ids: list[uuid.UUID] = Field(min_length=1)
    name: str | None = Field(default=None, max_length=120)

    @model_validator(mode="after")
    def _check_shape(self) -> ChatCreate:
        unique = list(dict.fromkeys(self.member_ids))
        self.member_ids = unique

        if self.type is ConversationType.direct:
            if len(unique) != 1:
                raise ValueError(
                    "A direct chat takes exactly one member_id (the other person)."
                )
            if self.name is not None:
                raise ValueError(
                    "A direct chat cannot have a name; it is labelled with the "
                    "other member's name."
                )
        else:
            if not (self.name and self.name.strip()):
                raise ValueError("A group chat requires a name.")
            if len(unique) > MAX_GROUP_MEMBERS - 1:
                raise ValueError(
                    f"A group chat supports at most {MAX_GROUP_MEMBERS} members."
                )
        return self
