from __future__ import annotations

from pydantic import BaseModel

from app.models.message import MessageType


class UploadResponse(BaseModel):
    """What POST /api/upload returns.

    Send `url`, `file_name` and `file_size` straight back as the file fields of
    a message; `message_type` is the value to use for that message.
    """

    url: str
    file_name: str
    content_type: str
    file_size: int
    message_type: MessageType
