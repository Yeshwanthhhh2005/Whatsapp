"""WebSocket message envelopes.

Every frame in both directions is JSON shaped as::

    {"event": "<name>", "data": {...}}

Inbound events (client -> server):
    message       -- {content?, message_type?, file_url?, file_name?,
                      file_size?, client_id?}
    typing_start  -- {}
    typing_stop   -- {}
    message_read  -- {up_to_message_id?}
    ping          -- {}

Outbound events (server -> client):
    connected       -- {user_id, chat_id}
    message         -- {chat_id, message}
    message_updated -- {chat_id, message}
    message_deleted -- {chat_id, message_id}
    typing          -- {chat_id, user_id, name, is_typing}
    message_read    -- {chat_id, reader_id, message_ids, read_at}
    presence        -- {user_id, is_online, last_seen}
    pong            -- {}
    error           -- {detail}
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.message import MessageCreate, MessageOut


class Envelope(BaseModel):
    """Outbound frame."""

    event: str
    data: dict[str, Any] = Field(default_factory=dict)


def envelope(event: str, data: BaseModel | dict[str, Any] | None = None) -> dict:
    """Build a JSON-ready outbound frame.

    `jsonable_encoder` turns UUIDs, datetimes and enums into JSON primitives,
    which `WebSocket.send_json` will not do on its own.
    """
    from fastapi.encoders import jsonable_encoder

    if data is None:
        payload: dict[str, Any] = {}
    elif isinstance(data, BaseModel):
        payload = data.model_dump()
    else:
        payload = data
    return {"event": event, "data": jsonable_encoder(payload)}


class InboundFrame(BaseModel):
    """Loose by design: the handler validates `data` per event type."""

    model_config = ConfigDict(extra="ignore")

    event: Literal[
        "message",
        "typing_start",
        "typing_stop",
        "message_read",
        "ping",
    ]
    data: dict[str, Any] = Field(default_factory=dict)


class WsMessagePayload(MessageCreate):
    """Inbound `message` data -- identical to the REST create body."""


class TypingEvent(BaseModel):
    chat_id: uuid.UUID
    user_id: uuid.UUID
    name: str
    is_typing: bool


class PresenceEvent(BaseModel):
    user_id: uuid.UUID
    is_online: bool
    last_seen: datetime | None = None


class ReadEvent(BaseModel):
    chat_id: uuid.UUID
    reader_id: uuid.UUID
    message_ids: list[uuid.UUID]
    read_at: datetime


class MessageEvent(BaseModel):
    chat_id: uuid.UUID
    message: MessageOut
