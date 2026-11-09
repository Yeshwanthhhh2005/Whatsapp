from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import CurrentUser
from app.database import get_db
from app.schemas.chat import ChatCreate, ChatOut
from app.services import chat_service

router = APIRouter(prefix="/chats", tags=["chats"])

CHAT_NOT_FOUND = HTTPException(
    status_code=status.HTTP_404_NOT_FOUND,
    detail="Chat not found.",
)


@router.get(
    "",
    response_model=list[ChatOut],
    summary="Every chat the user belongs to",
    description=(
        "Ordered by most recent activity. Each entry carries its display name, "
        "members, last message, last message time, and unread count."
    ),
)
async def list_chats(
    current_user: CurrentUser, db: AsyncSession = Depends(get_db)
) -> list[ChatOut]:
    return await chat_service.list_chats_for_user(db, current_user)


@router.post(
    "",
    response_model=ChatOut,
    status_code=status.HTTP_201_CREATED,
    summary="Start a direct or group chat",
    description=(
        "Direct chats are unique per pair: asking for one that already exists "
        "returns it with 200 instead of creating a duplicate."
    ),
)
async def create_chat(
    payload: ChatCreate,
    current_user: CurrentUser,
    response: Response,
    db: AsyncSession = Depends(get_db),
) -> ChatOut:
    try:
        conversation, created = await chat_service.create_chat(
            db, current_user, payload
        )
    except chat_service.ChatError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
        ) from None

    if not created:
        response.status_code = status.HTTP_200_OK

    payloads = await chat_service.build_chat_payloads(
        db, [conversation], current_user.id
    )
    return payloads[0]


@router.get("/{chat_id}", response_model=ChatOut, summary="One chat")
async def get_chat(
    chat_id: uuid.UUID,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
) -> ChatOut:
    try:
        return await chat_service.get_chat_for_user(db, chat_id, current_user)
    except chat_service.NotAMember:
        # 404 rather than 403: a non-member should not learn the chat exists.
        raise CHAT_NOT_FOUND from None
