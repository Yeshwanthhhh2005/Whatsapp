from __future__ import annotations

import enum
import uuid
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    String,
    Text,
    func,
)
from sqlalchemy.ext.hybrid import hybrid_property
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, utcnow
from app.models.user import User


class MessageType(str, enum.Enum):
    text = "text"
    image = "image"
    document = "document"


class MessageStatus(str, enum.Enum):
    """The three states the frontend check marks render.

    sent       - persisted to the database
    delivered  - at least one other member had a live WebSocket connection
    read       - at least one other member marked the chat read past it
    """

    sent = "sent"
    delivered = "delivered"
    read = "read"


_message_type = Enum(
    MessageType,
    name="message_type",
    native_enum=False,
    values_callable=lambda enum_cls: [member.value for member in enum_cls],
)
_message_status = Enum(
    MessageStatus,
    name="message_status",
    native_enum=False,
    values_callable=lambda enum_cls: [member.value for member in enum_cls],
)


class Message(Base):
    __tablename__ = "messages"
    __table_args__ = (
        # Serves both the keyset pagination and the "latest message per chat"
        # window query.
        Index("ix_messages_chat_created", "conversation_id", "created_at", "id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    # Exposed to the API as chat_id, but named for the conversations table it
    # points at so the database schema stays internally consistent.
    conversation_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False
    )
    sender_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # NULL for an attachment with no caption, and cleared on delete.
    content: Mapped[str | None] = mapped_column(Text)
    message_type: Mapped[MessageType] = mapped_column(
        _message_type, nullable=False, default=MessageType.text
    )

    # Populated for image / document messages. See POST /api/upload.
    file_url: Mapped[str | None] = mapped_column(String(512))
    file_name: Mapped[str | None] = mapped_column(String(255))
    file_size: Mapped[int | None] = mapped_column(BigInteger)

    status: Mapped[MessageStatus] = mapped_column(
        _message_status, nullable=False, default=MessageStatus.sent
    )
    # Generated in Python, not by func.now(): SQLite's CURRENT_TIMESTAMP has
    # only second resolution and PostgreSQL's now() is transaction-scoped, so
    # either way rows written in quick succession share a timestamp -- and then
    # ordering falls back to a random UUID and history renders in a different
    # order on every load. server_default stays as a fallback for any insert
    # that bypasses the ORM.
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=utcnow,
        server_default=func.now(),
        index=True,
    )
    edited_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Soft delete, so connected clients can be told to swap the bubble for
    # "This message was deleted" instead of silently losing a row.
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    sender: Mapped[User] = relationship(lazy="selectin")

    @property
    def chat_id(self) -> uuid.UUID:
        """The name the API uses for conversation_id."""
        return self.conversation_id

    @hybrid_property
    def is_read(self) -> bool:
        """Derived from status, so the two can never drift apart."""
        return self.status == MessageStatus.read

    @is_read.inplace.expression
    @classmethod
    def _is_read_expression(cls):
        return cls.status == MessageStatus.read

    @hybrid_property
    def is_deleted(self) -> bool:
        return self.deleted_at is not None

    @is_deleted.inplace.expression
    @classmethod
    def _is_deleted_expression(cls):
        return cls.deleted_at.is_not(None)
