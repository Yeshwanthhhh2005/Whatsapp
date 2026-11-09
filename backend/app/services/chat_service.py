"""Conversation creation and the assembled chat payloads the UI renders."""

from __future__ import annotations

import uuid

from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import aliased, selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    as_aware,
    Conversation,
    ConversationMember,
    ConversationType,
    Message,
    User,
)
from app.schemas.chat import ChatCreate, ChatMember, ChatOut
from app.schemas.message import MessageOut
from app.schemas.user import UserPublic


class ChatError(Exception):
    """Business-rule violation; routes turn this into a 400."""


class NotAMember(Exception):
    """The requesting user cannot see this conversation."""


# --------------------------------------------------------------------------
# Membership
# --------------------------------------------------------------------------


async def get_membership(
    db: AsyncSession, chat_id: uuid.UUID, user_id: uuid.UUID
) -> ConversationMember | None:
    result = await db.execute(
        select(ConversationMember).where(
            ConversationMember.conversation_id == chat_id,
            ConversationMember.user_id == user_id,
        )
    )
    return result.scalar_one_or_none()


async def member_ids(db: AsyncSession, chat_id: uuid.UUID) -> list[uuid.UUID]:
    result = await db.execute(
        select(ConversationMember.user_id).where(
            ConversationMember.conversation_id == chat_id
        )
    )
    return list(result.scalars().all())


async def chat_ids_for_user(db: AsyncSession, user_id: uuid.UUID) -> list[uuid.UUID]:
    result = await db.execute(
        select(ConversationMember.conversation_id).where(
            ConversationMember.user_id == user_id
        )
    )
    return list(result.scalars().all())


async def require_membership(
    db: AsyncSession, chat_id: uuid.UUID, user_id: uuid.UUID
) -> ConversationMember:
    membership = await get_membership(db, chat_id, user_id)
    if membership is None:
        # Deliberately indistinguishable from "no such chat", so chat ids
        # cannot be probed for existence.
        raise NotAMember(str(chat_id))
    return membership


# --------------------------------------------------------------------------
# Creation
# --------------------------------------------------------------------------


async def _find_direct_chat(
    db: AsyncSession, user_a: uuid.UUID, user_b: uuid.UUID
) -> Conversation | None:
    """Direct chats are unique per pair, so creating one twice reuses it.

    Direct conversations always have exactly two members by construction, so
    matching both user ids is enough -- no member-count check needed.
    """
    side_a = aliased(ConversationMember)
    side_b = aliased(ConversationMember)
    result = await db.execute(
        select(Conversation)
        .join(side_a, side_a.conversation_id == Conversation.id)
        .join(side_b, side_b.conversation_id == Conversation.id)
        .where(
            Conversation.type == ConversationType.direct,
            side_a.user_id == user_a,
            side_b.user_id == user_b,
        )
        .limit(1)
    )
    return result.scalar_one_or_none()


async def create_chat(
    db: AsyncSession, creator: User, payload: ChatCreate
) -> tuple[Conversation, bool]:
    """Create a conversation. Returns (conversation, was_created)."""
    others = [uid for uid in payload.member_ids if uid != creator.id]

    if payload.type is ConversationType.direct:
        if not others:
            raise ChatError("Cannot open a direct chat with yourself.")
        existing = await _find_direct_chat(db, creator.id, others[0])
        if existing is not None:
            return existing, False

    if not others:
        raise ChatError("A chat needs at least one other member.")

    found = await db.execute(select(User.id).where(User.id.in_(others)))
    found_ids = set(found.scalars().all())
    missing = [str(uid) for uid in others if uid not in found_ids]
    if missing:
        raise ChatError(f"Unknown user id(s): {', '.join(missing)}")

    conversation = Conversation(
        type=payload.type,
        name=payload.name.strip() if payload.name else None,
        created_by=creator.id,
    )
    conversation.members.append(
        ConversationMember(
            user_id=creator.id,
            # Whoever makes a group administers it; direct chats have no admin.
            is_admin=payload.type is ConversationType.group,
        )
    )
    for uid in others:
        conversation.members.append(ConversationMember(user_id=uid))

    db.add(conversation)
    await db.commit()

    # Reload with members and their users eagerly attached.
    refreshed = await get_conversation(db, conversation.id)
    assert refreshed is not None
    return refreshed, True


async def get_conversation(
    db: AsyncSession, chat_id: uuid.UUID
) -> Conversation | None:
    result = await db.execute(
        select(Conversation)
        .where(Conversation.id == chat_id)
        .options(selectinload(Conversation.members).selectinload(ConversationMember.user))
    )
    return result.scalar_one_or_none()


# --------------------------------------------------------------------------
# Assembled payloads
# --------------------------------------------------------------------------


def _display_name(conversation: Conversation, viewer_id: uuid.UUID) -> str:
    if conversation.type is ConversationType.group:
        return conversation.name or "Group"

    for member in conversation.members:
        if member.user_id != viewer_id and member.user is not None:
            return member.user.name
    # A direct chat whose other member was deleted.
    return "Unknown contact"


async def _latest_messages(
    db: AsyncSession, chat_ids: list[uuid.UUID]
) -> dict[uuid.UUID, Message]:
    """One row per conversation: its newest message, deleted ones included.

    A deleted message still shows as the preview ("This message was deleted"),
    which is why `deleted_at` is not filtered here.
    """
    if not chat_ids:
        return {}

    ranked = (
        select(
            Message.id.label("id"),
            func.row_number()
            .over(
                partition_by=Message.conversation_id,
                order_by=(Message.created_at.desc(), Message.id.desc()),
            )
            .label("rank"),
        )
        .where(Message.conversation_id.in_(chat_ids))
        .subquery()
    )
    newest_ids = select(ranked.c.id).where(ranked.c.rank == 1)

    result = await db.execute(select(Message).where(Message.id.in_(newest_ids)))
    return {msg.conversation_id: msg for msg in result.scalars().all()}


async def _unread_counts(
    db: AsyncSession, chat_ids: list[uuid.UUID], viewer_id: uuid.UUID
) -> dict[uuid.UUID, int]:
    """Messages from other people newer than the viewer's read watermark."""
    if not chat_ids:
        return {}

    membership = aliased(ConversationMember)
    result = await db.execute(
        select(Message.conversation_id, func.count(Message.id))
        .join(
            membership,
            and_(
                membership.conversation_id == Message.conversation_id,
                membership.user_id == viewer_id,
            ),
        )
        .where(
            Message.conversation_id.in_(chat_ids),
            Message.sender_id != viewer_id,
            Message.deleted_at.is_(None),
            or_(
                membership.last_read_at.is_(None),
                Message.created_at > membership.last_read_at,
            ),
        )
        .group_by(Message.conversation_id)
    )
    return {chat_id: count for chat_id, count in result.all()}


def _to_chat_out(
    conversation: Conversation,
    viewer_id: uuid.UUID,
    last_message: Message | None,
    unread_count: int,
) -> ChatOut:
    return ChatOut(
        id=conversation.id,
        type=conversation.type,
        is_group=conversation.type is ConversationType.group,
        name=_display_name(conversation, viewer_id),
        members=[
            ChatMember(
                user=UserPublic.model_validate(member.user),
                is_admin=member.is_admin,
                joined_at=member.joined_at,
            )
            for member in conversation.members
            if member.user is not None
        ],
        last_message=(
            MessageOut.model_validate(last_message) if last_message else None
        ),
        last_message_at=last_message.created_at if last_message else None,
        unread_count=unread_count,
        created_at=conversation.created_at,
    )


async def build_chat_payloads(
    db: AsyncSession, conversations: list[Conversation], viewer_id: uuid.UUID
) -> list[ChatOut]:
    """Assemble ChatOut for several conversations using three queries total."""
    chat_ids = [conversation.id for conversation in conversations]
    latest = await _latest_messages(db, chat_ids)
    unread = await _unread_counts(db, chat_ids, viewer_id)

    payloads = [
        _to_chat_out(
            conversation,
            viewer_id,
            latest.get(conversation.id),
            unread.get(conversation.id, 0),
        )
        for conversation in conversations
    ]
    # Most recent activity first; chats with no messages sort by creation.
    payloads.sort(
        key=lambda chat: as_aware(chat.last_message_at or chat.created_at),
        reverse=True,
    )
    return payloads


async def list_chats_for_user(db: AsyncSession, user: User) -> list[ChatOut]:
    result = await db.execute(
        select(Conversation)
        .join(
            ConversationMember,
            ConversationMember.conversation_id == Conversation.id,
        )
        .where(ConversationMember.user_id == user.id)
        .options(
            selectinload(Conversation.members).selectinload(ConversationMember.user)
        )
    )
    conversations = list(result.scalars().unique().all())
    return await build_chat_payloads(db, conversations, user.id)


async def get_chat_for_user(
    db: AsyncSession, chat_id: uuid.UUID, user: User
) -> ChatOut:
    await require_membership(db, chat_id, user.id)
    conversation = await get_conversation(db, chat_id)
    if conversation is None:
        raise NotAMember(str(chat_id))
    payloads = await build_chat_payloads(db, [conversation], user.id)
    return payloads[0]
