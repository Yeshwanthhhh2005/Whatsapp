"""Message history, sending, editing, deleting, and read receipts."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    ConversationMember,
    Message,
    MessageStatus,
    MessageType,
    User,
    as_aware,
    utcnow,
)
from app.schemas.message import MessageCreate, MessageUpdate

DEFAULT_PAGE_SIZE = 50
MAX_PAGE_SIZE = 100


class MessageError(Exception):
    """Business-rule violation; routes turn this into a 400."""


class MessageNotFound(Exception):
    pass


class NotTheSender(Exception):
    pass


async def get_message(db: AsyncSession, message_id: uuid.UUID) -> Message | None:
    return await db.get(Message, message_id)


# --------------------------------------------------------------------------
# History
# --------------------------------------------------------------------------


async def list_messages(
    db: AsyncSession,
    chat_id: uuid.UUID,
    limit: int = DEFAULT_PAGE_SIZE,
    before: uuid.UUID | None = None,
) -> tuple[list[Message], bool]:
    """Newest-first page of history. Returns (messages, has_more).

    Keyset pagination on (created_at, id) rather than OFFSET: a stable cursor
    that does not skip or repeat rows when new messages land mid-scroll.
    """
    limit = max(1, min(limit, MAX_PAGE_SIZE))
    conditions = [Message.conversation_id == chat_id]

    if before is not None:
        anchor = await db.get(Message, before)
        if anchor is None or anchor.conversation_id != chat_id:
            raise MessageError("Cursor message does not belong to this chat.")
        conditions.append(
            or_(
                Message.created_at < anchor.created_at,
                and_(
                    Message.created_at == anchor.created_at,
                    Message.id < anchor.id,
                ),
            )
        )

    result = await db.execute(
        select(Message)
        .where(*conditions)
        .order_by(Message.created_at.desc(), Message.id.desc())
        # One extra row tells us whether another page exists.
        .limit(limit + 1)
    )
    rows = list(result.scalars().all())
    has_more = len(rows) > limit
    return rows[:limit], has_more


# --------------------------------------------------------------------------
# Writing
# --------------------------------------------------------------------------


async def create_message(
    db: AsyncSession,
    chat_id: uuid.UUID,
    sender: User,
    payload: MessageCreate,
) -> Message:
    content = payload.content.strip() if payload.content else None

    message = Message(
        conversation_id=chat_id,
        sender_id=sender.id,
        content=content,
        message_type=payload.message_type,
        file_url=payload.file_url,
        file_name=payload.file_name,
        file_size=payload.file_size,
        status=MessageStatus.sent,
    )
    db.add(message)
    await db.commit()
    await db.refresh(message)
    return message


async def mark_delivered(db: AsyncSession, message: Message) -> Message:
    """Promote sent -> delivered. Never downgrades an already-read message."""
    if message.status is MessageStatus.sent:
        message.status = MessageStatus.delivered
        await db.commit()
        await db.refresh(message)
    return message


async def update_message(
    db: AsyncSession, message: Message, editor: User, payload: MessageUpdate
) -> Message:
    if message.sender_id != editor.id:
        raise NotTheSender("Only the sender can edit a message.")
    if message.deleted_at is not None:
        raise MessageError("Cannot edit a deleted message.")
    if message.message_type is not MessageType.text:
        raise MessageError("Only text messages can be edited.")

    message.content = payload.content.strip()
    message.edited_at = utcnow()
    await db.commit()
    await db.refresh(message)
    return message


async def delete_message(
    db: AsyncSession, message: Message, requester: User
) -> Message:
    """Soft delete, WhatsApp's "delete for everyone".

    The row survives so connected clients can swap the bubble for a tombstone
    and history stays consistent; the body and any attachment reference are
    cleared.
    """
    if message.sender_id != requester.id:
        raise NotTheSender("Only the sender can delete a message.")

    if message.deleted_at is None:
        message.deleted_at = utcnow()
        message.content = None
        message.file_url = None
        message.file_name = None
        message.file_size = None
        await db.commit()
        await db.refresh(message)
    return message


# --------------------------------------------------------------------------
# Read receipts
# --------------------------------------------------------------------------


async def mark_read(
    db: AsyncSession,
    membership: ConversationMember,
    reader: User,
    up_to_message_id: uuid.UUID | None = None,
) -> tuple[list[uuid.UUID], datetime]:
    """Advance the reader's watermark and flag the messages it covers.

    Returns the ids whose status changed (so they can be broadcast) and the
    timestamp used.

    In a group this sets a message to `read` once *any* other member reads it.
    Per-member receipts would need a message_reads table, which this MVP
    deliberately skips -- for one-to-one chats, the case the check marks are
    really about, the result is exact.
    """
    chat_id = membership.conversation_id
    watermark = utcnow()

    if up_to_message_id is not None:
        anchor = await db.get(Message, up_to_message_id)
        if anchor is None or anchor.conversation_id != chat_id:
            raise MessageError("Message does not belong to this chat.")
        watermark = as_aware(anchor.created_at)

    # Never move the watermark backwards -- an out-of-order receipt from a
    # second tab would otherwise resurrect already-read messages as unread.
    previous = as_aware(membership.last_read_at)
    if previous is None or watermark > previous:
        membership.last_read_at = watermark
    else:
        watermark = previous

    result = await db.execute(
        select(Message).where(
            Message.conversation_id == chat_id,
            Message.sender_id != reader.id,
            Message.deleted_at.is_(None),
            Message.created_at <= watermark,
            Message.status != MessageStatus.read,
        )
    )
    changed = list(result.scalars().all())
    for message in changed:
        message.status = MessageStatus.read

    await db.commit()
    return [message.id for message in changed], watermark
