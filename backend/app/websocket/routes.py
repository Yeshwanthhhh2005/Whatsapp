"""The /ws/{chat_id} endpoint.

Sessions are opened per operation rather than held for the life of the socket.
A connection can stay open for hours; a session held that long would pin a
pooled PostgreSQL connection and keep an idle transaction open the whole time.
"""

from __future__ import annotations

import logging
import uuid

import anyio
from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect
from pydantic import ValidationError

from app.auth.dependencies import authenticate_websocket
from app.database import get_session_factory
from app.models import User
from app.schemas.message import MessageCreate
from app.schemas.ws import InboundFrame, envelope
from app.services import chat_service, message_service, presence_service
from app.websocket import events
from app.websocket.manager import Connection, manager

logger = logging.getLogger(__name__)

router = APIRouter()

# Application close codes (4000-4999 is the private range).
CLOSE_UNAUTHORIZED = 4401
CLOSE_FORBIDDEN = 4403
CLOSE_BAD_REQUEST = 4400


@router.websocket("/ws/{chat_id}")
async def chat_socket(
    websocket: WebSocket,
    chat_id: uuid.UUID,
    token: str | None = Query(
        default=None,
        description=(
            "JWT access token. Passed in the query string because browsers "
            "cannot set headers on a WebSocket handshake."
        ),
    ),
) -> None:
    session_factory = get_session_factory()

    # Accept first, then authorise.
    #
    # Closing before accept makes the ASGI server reject the HTTP upgrade
    # itself, and a rejected handshake cannot carry a WebSocket close code --
    # the browser just reports 1006 and the client cannot tell "your token
    # expired" from "the network blipped", so it retries forever. Accepting
    # and then closing with an explicit code (plus an `error` frame) is what
    # actually reaches the client. Nothing is read from the socket and no work
    # is done until the checks below pass.
    await websocket.accept()

    async def reject(code: int, detail: str) -> None:
        try:
            await websocket.send_json(envelope("error", {"detail": detail}))
            await websocket.close(code=code)
        except Exception:  # noqa: BLE001 - client may already be gone
            pass

    async with session_factory() as db:
        user = await authenticate_websocket(db, token)
        if user is None:
            await reject(CLOSE_UNAUTHORIZED, "Invalid or expired token.")
            return
        membership = await chat_service.get_membership(db, chat_id, user.id)
        if membership is None:
            await reject(CLOSE_FORBIDDEN, "You are not a member of this chat.")
            return
        members = await chat_service.member_ids(db, chat_id)

    connection, became_online = await manager.connect(websocket, user.id, chat_id)

    try:
        if became_online:
            async with session_factory() as db:
                await presence_service.set_online(db, user.id)
                last_seen = await presence_service.get_last_seen(db, user.id)
                await events.publish_presence(db, user, True, last_seen)

        await websocket.send_json(
            envelope("connected", {"user_id": user.id, "chat_id": chat_id})
        )

        while True:
            raw = await websocket.receive_json()
            await _dispatch(raw, connection, user, chat_id, members)

    except WebSocketDisconnect:
        pass
    except Exception:  # noqa: BLE001 - never let one socket take down others
        logger.exception("WebSocket error for user %s in chat %s", user.id, chat_id)
    finally:
        # Shielded because some ASGI servers cancel the handler task when the
        # socket closes (Starlette's TestClient does, and Uvicorn does during
        # shutdown). Without the shield every await below raises CancelledError
        # immediately, the cleanup is abandoned, and the user is left flagged
        # online forever with no last_seen -- which is exactly the state the
        # UI must never show.
        with anyio.CancelScope(shield=True):
            went_offline = await manager.disconnect(connection)
            if went_offline:
                try:
                    async with session_factory() as db:
                        await presence_service.set_offline(db, user.id)
                        last_seen = await presence_service.get_last_seen(db, user.id)
                        await events.publish_presence(db, user, False, last_seen)
                except Exception:  # noqa: BLE001 - teardown must not raise
                    logger.warning(
                        "Could not record user %s going offline", user.id, exc_info=True
                    )


async def _dispatch(
    raw: object,
    connection: Connection,
    user: User,
    chat_id: uuid.UUID,
    members: list[uuid.UUID],
) -> None:
    """Route one inbound frame. Bad frames get an error back, not a disconnect."""
    try:
        frame = InboundFrame.model_validate(raw)
    except ValidationError as exc:
        await connection.send(
            envelope("error", {"detail": f"Unrecognised frame: {exc.errors()[0]['msg']}"})
        )
        return

    session_factory = get_session_factory()

    if frame.event == "ping":
        await connection.send(envelope("pong"))
        return

    if frame.event == "typing_start":
        await events.publish_typing(chat_id, user, True, exclude=connection)
        return

    if frame.event == "typing_stop":
        await events.publish_typing(chat_id, user, False, exclude=connection)
        return

    if frame.event == "message":
        try:
            payload = MessageCreate.model_validate(frame.data)
        except ValidationError as exc:
            await connection.send(
                envelope("error", {"detail": exc.errors()[0]["msg"]})
            )
            return

        async with session_factory() as db:
            message = await message_service.create_message(
                db, chat_id, user, payload
            )
            # Sending implies you have seen what came before, so clear your
            # own unread count rather than leaving a badge on an open chat.
            membership = await chat_service.get_membership(db, chat_id, user.id)
            if membership is not None:
                read_ids, read_at = await message_service.mark_read(
                    db, membership, user
                )
                # And tell the other side, or their ticks stay grey even though
                # their messages are marked read in the database.
                await events.publish_read_receipt(
                    db, chat_id, user, read_ids, read_at, member_ids=members
                )
            await events.publish_new_message(
                db,
                message,
                member_ids=members,
                client_id=payload.client_id,
            )
        return

    if frame.event == "message_read":
        up_to = frame.data.get("up_to_message_id")
        try:
            up_to_id = uuid.UUID(str(up_to)) if up_to else None
        except ValueError:
            await connection.send(
                envelope("error", {"detail": "up_to_message_id is not a valid id."})
            )
            return

        async with session_factory() as db:
            membership = await chat_service.get_membership(db, chat_id, user.id)
            if membership is None:
                return
            try:
                message_ids, read_at = await message_service.mark_read(
                    db, membership, user, up_to_id
                )
            except message_service.MessageError as exc:
                await connection.send(envelope("error", {"detail": str(exc)}))
                return
            await events.publish_read_receipt(
                db, chat_id, user, message_ids, read_at, member_ids=members
            )
        return
