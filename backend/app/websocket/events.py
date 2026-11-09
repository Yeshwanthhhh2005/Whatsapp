"""Shared broadcast helpers.

Both the WebSocket handler and the REST routes call these, so a message sent
over HTTP reaches connected clients exactly like one sent over the socket.
Without this the two paths would drift and REST-sent messages would only show
up on refresh.
"""

from __future__ import annotations

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Message, User
from app.schemas.message import MessageOut
from app.schemas.ws import (
    MessageEvent,
    PresenceEvent,
    ReadEvent,
    TypingEvent,
    envelope,
)
from app.services import chat_service, message_service
from app.websocket.manager import Connection, manager


def _message_out(message: Message, client_id: str | None = None) -> MessageOut:
    payload = MessageOut.model_validate(message)
    if client_id:
        payload.client_id = client_id
    return payload


async def publish_new_message(
    db: AsyncSession,
    message: Message,
    *,
    member_ids: list[uuid.UUID] | None = None,
    client_id: str | None = None,
) -> MessageOut:
    """Persisted -> fan out -> promote to `delivered` if anyone is listening.

    Returns the serialised message, with `delivered` already reflected so the
    HTTP response and the broadcast frame agree.
    """
    chat_id = message.conversation_id
    recipients = (
        member_ids
        if member_ids is not None
        else await chat_service.member_ids(db, chat_id)
    )

    await manager.send_to_users(
        recipients,
        envelope(
            "message",
            MessageEvent(chat_id=chat_id, message=_message_out(message, client_id)),
        ),
    )

    if manager.any_online(recipients, exclude=message.sender_id):
        await message_service.mark_delivered(db, message)
        # Tell the sender's own clients the tick turned double.
        await manager.send_to_users(
            [message.sender_id],
            envelope(
                "message_updated",
                MessageEvent(chat_id=chat_id, message=_message_out(message)),
            ),
        )

    return _message_out(message, client_id)


async def publish_message_updated(
    db: AsyncSession, message: Message, *, member_ids: list[uuid.UUID] | None = None
) -> None:
    chat_id = message.conversation_id
    recipients = (
        member_ids
        if member_ids is not None
        else await chat_service.member_ids(db, chat_id)
    )
    await manager.send_to_users(
        recipients,
        envelope(
            "message_updated",
            MessageEvent(chat_id=chat_id, message=_message_out(message)),
        ),
    )


async def publish_message_deleted(
    db: AsyncSession, message: Message, *, member_ids: list[uuid.UUID] | None = None
) -> None:
    chat_id = message.conversation_id
    recipients = (
        member_ids
        if member_ids is not None
        else await chat_service.member_ids(db, chat_id)
    )
    await manager.send_to_users(
        recipients,
        envelope(
            "message_deleted",
            {"chat_id": chat_id, "message_id": message.id},
        ),
    )


async def publish_read_receipt(
    db: AsyncSession,
    chat_id: uuid.UUID,
    reader: User,
    message_ids: list[uuid.UUID],
    read_at,
    *,
    member_ids: list[uuid.UUID] | None = None,
) -> None:
    if not message_ids:
        return
    recipients = (
        member_ids
        if member_ids is not None
        else await chat_service.member_ids(db, chat_id)
    )
    await manager.send_to_users(
        recipients,
        envelope(
            "message_read",
            ReadEvent(
                chat_id=chat_id,
                reader_id=reader.id,
                message_ids=message_ids,
                read_at=read_at,
            ),
        ),
        # The reader's own tabs already know.
        exclude_user=reader.id,
    )


async def publish_typing(
    chat_id: uuid.UUID,
    user: User,
    is_typing: bool,
    *,
    exclude: Connection | None = None,
) -> None:
    """Room-scoped and never persisted -- typing state is ephemeral."""
    await manager.broadcast_to_chat(
        chat_id,
        envelope(
            "typing",
            TypingEvent(
                chat_id=chat_id,
                user_id=user.id,
                name=user.name,
                is_typing=is_typing,
            ),
        ),
        exclude=exclude,
    )


async def publish_presence(
    db: AsyncSession, user: User, is_online: bool, last_seen
) -> None:
    """Tell everyone who shares a chat with this user that they came or went."""
    chat_ids = await chat_service.chat_ids_for_user(db, user.id)
    if not chat_ids:
        return

    audience: set[uuid.UUID] = set()
    for chat_id in chat_ids:
        audience.update(await chat_service.member_ids(db, chat_id))
    audience.discard(user.id)
    if not audience:
        return

    await manager.send_to_users(
        list(audience),
        envelope(
            "presence",
            PresenceEvent(user_id=user.id, is_online=is_online, last_seen=last_seen),
        ),
    )
