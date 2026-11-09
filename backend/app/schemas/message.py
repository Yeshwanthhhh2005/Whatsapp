from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.models.message import MessageStatus, MessageType
from app.schemas.user import UserPublic


class MessageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    # Message.chat_id is a property aliasing the conversation_id column.
    chat_id: uuid.UUID
    sender_id: uuid.UUID
    sender: UserPublic | None = None
    content: str | None = None
    message_type: MessageType
    file_url: str | None = None
    file_name: str | None = None
    file_size: int | None = None
    status: MessageStatus
    is_read: bool
    is_deleted: bool
    created_at: datetime
    edited_at: datetime | None = None

    # Echoed back on the WebSocket broadcast so the sending client can match
    # the saved message to its optimistic bubble. Never persisted.
    client_id: str | None = None


class MessageCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    content: str | None = Field(default=None, max_length=8000)
    message_type: MessageType = MessageType.text
    file_url: str | None = Field(default=None, max_length=512)
    file_name: str | None = Field(default=None, max_length=255)
    file_size: int | None = Field(default=None, ge=0)
    client_id: str | None = Field(default=None, max_length=64)

    @model_validator(mode="after")
    def _check_payload(self) -> MessageCreate:
        if self.message_type is MessageType.text:
            if not (self.content and self.content.strip()):
                raise ValueError("A text message requires non-empty content.")
        elif not self.file_url:
            raise ValueError(
                f"A {self.message_type.value} message requires file_url "
                "(upload the file via POST /api/upload first)."
            )
        return self


class MessageUpdate(BaseModel):
    """Only the text body is editable, matching what the UI exposes."""

    model_config = ConfigDict(extra="forbid")

    content: str = Field(min_length=1, max_length=8000)


class MessagePage(BaseModel):
    """One page of history, newest first.

    Pass `next_cursor` back as `?before=` to fetch the next, older page.
    Reverse `items` for top-to-bottom display.
    """

    items: list[MessageOut]
    has_more: bool
    next_cursor: uuid.UUID | None = None


class MarkReadRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # Omit to mark the whole chat read up to now.
    up_to_message_id: uuid.UUID | None = None


class MarkReadResponse(BaseModel):
    chat_id: uuid.UUID
    read_at: datetime
    message_ids: list[uuid.UUID]
