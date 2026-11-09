"""In-process WebSocket connection registry and fan-out.

Connections are indexed twice:

* by chat, for room-scoped events (typing);
* by user, for everything a member should see regardless of which chat they
  currently have open -- new messages, read receipts, presence.

The second index is what makes the chat list update live. The route is
``/ws/{chat_id}`` as specified, but delivery is not confined to that room: a
message is pushed to every connection belonging to every member of the chat,
so an unopened conversation still shows its badge the moment a message lands.

State is per-process, which is the right trade for a single-process MVP. Two
Uvicorn workers would each see only their own connections; that is the point at
which a shared pub/sub backend becomes necessary, and it is deliberately out of
scope here.
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from dataclasses import dataclass, field
from typing import Any

from fastapi import WebSocket

logger = logging.getLogger(__name__)


@dataclass(eq=False)
class Connection:
    """One open socket. Identity is the object, hence eq=False for set use."""

    websocket: WebSocket
    user_id: uuid.UUID
    chat_id: uuid.UUID
    id: uuid.UUID = field(default_factory=uuid.uuid4)

    async def send(self, payload: dict[str, Any]) -> bool:
        """Send one frame. False means the socket is gone."""
        try:
            await self.websocket.send_json(payload)
            return True
        except Exception:  # noqa: BLE001 - any failure means drop the socket
            return False


class ConnectionManager:
    def __init__(self) -> None:
        self._by_chat: dict[uuid.UUID, set[Connection]] = {}
        self._by_user: dict[uuid.UUID, set[Connection]] = {}
        self._lock = asyncio.Lock()

    # -- lifecycle ---------------------------------------------------------

    async def connect(
        self, websocket: WebSocket, user_id: uuid.UUID, chat_id: uuid.UUID
    ) -> tuple[Connection, bool]:
        """Register an accepted socket.

        Returns the connection and whether this is the user's *first* one, so
        the caller only announces presence on the 0 -> 1 transition.
        """
        connection = Connection(websocket=websocket, user_id=user_id, chat_id=chat_id)
        async with self._lock:
            self._by_chat.setdefault(chat_id, set()).add(connection)
            user_connections = self._by_user.setdefault(user_id, set())
            became_online = len(user_connections) == 0
            user_connections.add(connection)
        return connection, became_online

    async def disconnect(self, connection: Connection) -> bool:
        """Deregister a socket. Returns True if it was the user's last one."""
        async with self._lock:
            chat_peers = self._by_chat.get(connection.chat_id)
            if chat_peers is not None:
                chat_peers.discard(connection)
                if not chat_peers:
                    del self._by_chat[connection.chat_id]

            user_connections = self._by_user.get(connection.user_id)
            went_offline = False
            if user_connections is not None:
                user_connections.discard(connection)
                if not user_connections:
                    del self._by_user[connection.user_id]
                    went_offline = True
        return went_offline

    # -- queries -----------------------------------------------------------

    def is_user_online(self, user_id: uuid.UUID) -> bool:
        return bool(self._by_user.get(user_id))

    def any_online(self, user_ids: list[uuid.UUID], exclude: uuid.UUID) -> bool:
        return any(
            self.is_user_online(user_id) for user_id in user_ids if user_id != exclude
        )

    # -- fan-out -----------------------------------------------------------

    async def _deliver(
        self, targets: set[Connection], payload: dict[str, Any]
    ) -> None:
        if not targets:
            return
        # Snapshot first: the set can mutate while we await.
        snapshot = list(targets)
        results = await asyncio.gather(
            *(connection.send(payload) for connection in snapshot),
            return_exceptions=True,
        )
        dead = [
            connection
            for connection, ok in zip(snapshot, results, strict=True)
            if ok is not True
        ]
        for connection in dead:
            # A socket that failed mid-send is already closed; drop it so it
            # does not linger in the indexes or keep a user falsely "online".
            logger.debug("Dropping dead websocket for user %s", connection.user_id)
            await self.disconnect(connection)

    async def broadcast_to_chat(
        self,
        chat_id: uuid.UUID,
        payload: dict[str, Any],
        exclude: Connection | None = None,
    ) -> None:
        """Room-scoped: only sockets opened against this chat."""
        async with self._lock:
            targets = {
                connection
                for connection in self._by_chat.get(chat_id, set())
                if connection is not exclude
            }
        await self._deliver(targets, payload)

    async def send_to_users(
        self,
        user_ids: list[uuid.UUID],
        payload: dict[str, Any],
        exclude_user: uuid.UUID | None = None,
    ) -> None:
        """User-scoped: every socket of every listed user, any chat."""
        async with self._lock:
            targets: set[Connection] = set()
            for user_id in user_ids:
                if user_id == exclude_user:
                    continue
                targets |= self._by_user.get(user_id, set())
        await self._deliver(targets, payload)

    async def close_all(self) -> None:
        """Shut every socket down cleanly on application shutdown."""
        async with self._lock:
            connections = [
                connection
                for peers in self._by_chat.values()
                for connection in peers
            ]
            self._by_chat.clear()
            self._by_user.clear()
        for connection in connections:
            try:
                await connection.websocket.close(code=1001)
            except Exception:  # noqa: BLE001 - already closing down
                pass


# One registry per process.
manager = ConnectionManager()
