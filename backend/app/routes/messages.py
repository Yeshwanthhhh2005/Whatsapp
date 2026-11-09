"""Message history and writes.

Every mutation here also broadcasts over WebSocket, so a client that posts over
HTTP and a client listening on a socket stay in step.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import CurrentUser
from app.database import get_db
from app.schemas.message import (
    MarkReadRequest,
    MarkReadResponse,
    MessageCreate,
    MessageOut,
    MessagePage,
    MessageUpdate,
)
from app.services import chat_service, message_service
from app.websocket import events

router = APIRouter(tags=["messages"])

CHAT_NOT_FOUND = HTTPException(
    status_code=status.HTTP_404_NOT_FOUND, detail="Chat not found."
)
MESSAGE_NOT_FOUND = HTTPException(
    status_code=status.HTTP_404_NOT_FOUND, detail="Message not found."
)


@router.get(
    "/chats/{chat_id}/messages",
    response_model=MessagePage,
    summary="Paginated history, newest first",
    description=(
        "Keyset pagination. Pass the response's `next_cursor` back as `before` "
        "to load the next, older page. Reverse `items` for display."
    ),
)
async def list_messages(
    chat_id: uuid.UUID,
    current_user: CurrentUser,
    limit: int = Query(default=message_service.DEFAULT_PAGE_SIZE, ge=1, le=100),
    before: uuid.UUID | None = Query(
        default=None, description="Return messages older than this message id"
    ),
    db: AsyncSession = Depends(get_db),
) -> MessagePage:
    try:
        await chat_service.require_membership(db, chat_id, current_user.id)
    except chat_service.NotAMember:
        raise CHAT_NOT_FOUND from None

    try:
        messages, has_more = await message_service.list_messages(
            db, chat_id, limit=limit, before=before
        )
    except message_service.MessageError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
        ) from None

    return MessagePage(
        items=[MessageOut.model_validate(message) for message in messages],
        has_more=has_more,
        next_cursor=messages[-1].id if messages and has_more else None,
    )


@router.post(
    "/chats/{chat_id}/messages",
    response_model=MessageOut,
    status_code=status.HTTP_201_CREATED,
    summary="Send a message",
    description=(
        "Saves the message and broadcasts it to every member's open sockets. "
        "Clients may use this instead of the WebSocket `message` event; the "
        "result is identical."
    ),
)
async def send_message(
    chat_id: uuid.UUID,
    payload: MessageCreate,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
) -> MessageOut:
    try:
        membership = await chat_service.require_membership(
            db, chat_id, current_user.id
        )
    except chat_service.NotAMember:
        raise CHAT_NOT_FOUND from None

    message = await message_service.create_message(
        db, chat_id, current_user, payload
    )
    # Sending implies having seen everything before it -- and the other side
    # has to be told, or their ticks stay grey while the database says read.
    read_ids, read_at = await message_service.mark_read(db, membership, current_user)
    await events.publish_read_receipt(
        db, chat_id, current_user, read_ids, read_at
    )
    return await events.publish_new_message(
        db, message, client_id=payload.client_id
    )


@router.patch(
    "/messages/{message_id}",
    response_model=MessageOut,
    summary="Edit a message you sent",
)
async def edit_message(
    message_id: uuid.UUID,
    payload: MessageUpdate,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
) -> MessageOut:
    message = await message_service.get_message(db, message_id)
    if message is None:
        raise MESSAGE_NOT_FOUND
    try:
        await chat_service.require_membership(
            db, message.conversation_id, current_user.id
        )
    except chat_service.NotAMember:
        raise MESSAGE_NOT_FOUND from None

    try:
        message = await message_service.update_message(
            db, message, current_user, payload
        )
    except message_service.NotTheSender as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)
        ) from None
    except message_service.MessageError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
        ) from None

    await events.publish_message_updated(db, message)
    return MessageOut.model_validate(message)


@router.delete(
    "/messages/{message_id}",
    response_model=MessageOut,
    summary="Delete a message you sent",
    description=(
        "Soft delete, like WhatsApp's delete-for-everyone: the message stays "
        "in history with its body cleared and `is_deleted` set, so open "
        "clients can show a tombstone."
    ),
)
async def delete_message(
    message_id: uuid.UUID,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
) -> MessageOut:
    message = await message_service.get_message(db, message_id)
    if message is None:
        raise MESSAGE_NOT_FOUND
    try:
        await chat_service.require_membership(
            db, message.conversation_id, current_user.id
        )
    except chat_service.NotAMember:
        raise MESSAGE_NOT_FOUND from None

    try:
        message = await message_service.delete_message(db, message, current_user)
    except message_service.NotTheSender as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)
        ) from None

    await events.publish_message_deleted(db, message)
    return MessageOut.model_validate(message)


@router.post(
    "/chats/{chat_id}/read",
    response_model=MarkReadResponse,
    summary="Mark a chat read",
    description=(
        "Advances the caller's read watermark and flips the covered messages "
        "to `read`, which is what turns the sender's check marks blue. The "
        "WebSocket `message_read` event does the same thing."
    ),
)
async def mark_chat_read(
    chat_id: uuid.UUID,
    payload: MarkReadRequest,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
) -> MarkReadResponse:
    try:
        membership = await chat_service.require_membership(
            db, chat_id, current_user.id
        )
    except chat_service.NotAMember:
        raise CHAT_NOT_FOUND from None

    try:
        message_ids, read_at = await message_service.mark_read(
            db, membership, current_user, payload.up_to_message_id
        )
    except message_service.MessageError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
        ) from None

    await events.publish_read_receipt(
        db, chat_id, current_user, message_ids, read_at
    )
    return MarkReadResponse(
        chat_id=chat_id, read_at=read_at, message_ids=message_ids
    )
