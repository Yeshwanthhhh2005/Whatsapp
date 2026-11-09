"""The real-time path: delivery, typing, read receipts, presence."""

from __future__ import annotations


def _drain_until(socket, event: str, limit: int = 10) -> dict:
    """Read frames until `event` arrives, skipping the ones we do not want."""
    for _ in range(limit):
        frame = socket.receive_json()
        if frame["event"] == event:
            return frame
    raise AssertionError(f"Never received a {event!r} frame")


def _expect_rejection(client, url: str, expected_code: int) -> None:
    """Assert the server accepts, explains, then closes with `expected_code`.

    The route accepts before authorising on purpose: a close sent *before*
    accept makes the ASGI server reject the HTTP upgrade, and a rejected
    handshake carries no WebSocket close code -- the browser only sees 1006 and
    cannot tell an expired token from a network blip. So the contract is an
    `error` frame followed by a close with a real code.
    """
    import pytest
    from starlette.websockets import WebSocketDisconnect

    with pytest.raises(WebSocketDisconnect) as excinfo:
        with client.websocket_connect(url) as socket:
            frame = socket.receive_json()
            assert frame["event"] == "error", frame
            assert frame["data"]["detail"]
            # The close arrives on the next read.
            socket.receive_json()
    assert excinfo.value.code == expected_code


def test_connection_requires_a_valid_token(client, direct_chat):
    _expect_rejection(client, f"/ws/{direct_chat['id']}", 4401)


def test_connection_rejects_a_garbage_token(client, direct_chat):
    _expect_rejection(client, f"/ws/{direct_chat['id']}?token=not-a-jwt", 4401)


def test_non_member_cannot_connect(client, direct_chat, make_user):
    outsider = make_user("Outsider")
    _expect_rejection(
        client, f"/ws/{direct_chat['id']}?token={outsider['token']}", 4403
    )


def test_message_sent_over_socket_reaches_the_other_member(
    client, alice, bob, direct_chat
):
    chat_id = direct_chat["id"]
    with client.websocket_connect(f"/ws/{chat_id}?token={alice['token']}") as alice_ws:
        assert alice_ws.receive_json()["event"] == "connected"

        with client.websocket_connect(
            f"/ws/{chat_id}?token={bob['token']}"
        ) as bob_ws:
            assert bob_ws.receive_json()["event"] == "connected"
            # Alice is told Bob came online.
            presence = _drain_until(alice_ws, "presence")
            assert presence["data"]["user_id"] == bob["id"]
            assert presence["data"]["is_online"] is True

            alice_ws.send_json(
                {
                    "event": "message",
                    "data": {"content": "hello over the wire", "client_id": "tmp-1"},
                }
            )

            received = _drain_until(bob_ws, "message")
            assert received["data"]["chat_id"] == chat_id
            assert received["data"]["message"]["content"] == "hello over the wire"
            assert received["data"]["message"]["sender_id"] == alice["id"]

            # The sender gets the same frame, carrying its client_id back so it
            # can reconcile the optimistic bubble.
            echoed = _drain_until(alice_ws, "message")
            assert echoed["data"]["message"]["client_id"] == "tmp-1"

    # And it was persisted, not just broadcast.
    page = client.get(
        f"/api/chats/{chat_id}/messages", headers=bob["headers"]
    ).json()
    assert page["items"][0]["content"] == "hello over the wire"


def test_message_is_marked_delivered_when_a_recipient_is_connected(
    client, alice, bob, direct_chat
):
    chat_id = direct_chat["id"]
    with client.websocket_connect(f"/ws/{chat_id}?token={bob['token']}") as bob_ws:
        bob_ws.receive_json()  # connected

        sent = client.post(
            f"/api/chats/{chat_id}/messages",
            headers=alice["headers"],
            json={"content": "are you there?"},
        )
        assert sent.status_code == 201
        # Bob had a live socket, so the message goes out as delivered.
        assert sent.json()["status"] == "delivered"
        assert _drain_until(bob_ws, "message")["data"]["message"]["content"] == (
            "are you there?"
        )


def test_message_stays_sent_when_nobody_is_connected(client, alice, direct_chat):
    sent = client.post(
        f"/api/chats/{direct_chat['id']}/messages",
        headers=alice["headers"],
        json={"content": "into the void"},
    )
    assert sent.json()["status"] == "sent"


def test_typing_events_reach_the_room_but_not_the_sender(
    client, alice, bob, direct_chat
):
    chat_id = direct_chat["id"]
    with client.websocket_connect(f"/ws/{chat_id}?token={alice['token']}") as alice_ws:
        alice_ws.receive_json()
        with client.websocket_connect(
            f"/ws/{chat_id}?token={bob['token']}"
        ) as bob_ws:
            bob_ws.receive_json()
            _drain_until(alice_ws, "presence")

            alice_ws.send_json({"event": "typing_start", "data": {}})
            typing = _drain_until(bob_ws, "typing")
            assert typing["data"]["user_id"] == alice["id"]
            assert typing["data"]["name"] == "Alice"
            assert typing["data"]["is_typing"] is True

            alice_ws.send_json({"event": "typing_stop", "data": {}})
            assert _drain_until(bob_ws, "typing")["data"]["is_typing"] is False

            # Alice should not hear her own typing back; a ping round-trip
            # proves nothing else was queued for her.
            alice_ws.send_json({"event": "ping", "data": {}})
            assert alice_ws.receive_json()["event"] == "pong"


def test_read_receipt_over_socket_notifies_the_sender(client, alice, bob, direct_chat):
    chat_id = direct_chat["id"]
    message = client.post(
        f"/api/chats/{chat_id}/messages",
        headers=alice["headers"],
        json={"content": "read me"},
    ).json()

    with client.websocket_connect(f"/ws/{chat_id}?token={alice['token']}") as alice_ws:
        alice_ws.receive_json()
        with client.websocket_connect(
            f"/ws/{chat_id}?token={bob['token']}"
        ) as bob_ws:
            bob_ws.receive_json()
            _drain_until(alice_ws, "presence")

            bob_ws.send_json({"event": "message_read", "data": {}})

            receipt = _drain_until(alice_ws, "message_read")
            assert receipt["data"]["reader_id"] == bob["id"]
            assert message["id"] in receipt["data"]["message_ids"]


def test_presence_goes_false_on_disconnect(client, alice, bob, direct_chat):
    chat_id = direct_chat["id"]
    with client.websocket_connect(f"/ws/{chat_id}?token={alice['token']}") as alice_ws:
        alice_ws.receive_json()

        with client.websocket_connect(f"/ws/{chat_id}?token={bob['token']}") as bob_ws:
            bob_ws.receive_json()
            assert _drain_until(alice_ws, "presence")["data"]["is_online"] is True

        offline = _drain_until(alice_ws, "presence")
        assert offline["data"]["user_id"] == bob["id"]
        assert offline["data"]["is_online"] is False
        assert offline["data"]["last_seen"] is not None


def test_malformed_frame_gets_an_error_not_a_disconnect(client, alice, direct_chat):
    with client.websocket_connect(
        f"/ws/{direct_chat['id']}?token={alice['token']}"
    ) as socket:
        socket.receive_json()

        socket.send_json({"event": "nonsense", "data": {}})
        assert socket.receive_json()["event"] == "error"

        # An invalid message body is also non-fatal.
        socket.send_json({"event": "message", "data": {"content": "  "}})
        assert socket.receive_json()["event"] == "error"

        # The socket is still usable.
        socket.send_json({"event": "ping", "data": {}})
        assert socket.receive_json()["event"] == "pong"


def test_message_reaches_a_member_whose_open_chat_is_a_different_one(
    client, alice, bob, direct_chat, make_user
):
    """The chat list must update live, not only the open conversation.

    Bob is connected to another chat entirely; a message in direct_chat still
    has to reach him, which is what keeps his unread badge honest.
    """
    carol = make_user("Carol")
    other_chat = client.post(
        "/api/chats",
        headers=bob["headers"],
        json={"type": "direct", "member_ids": [carol["id"]]},
    ).json()

    with client.websocket_connect(
        f"/ws/{other_chat['id']}?token={bob['token']}"
    ) as bob_ws:
        bob_ws.receive_json()

        client.post(
            f"/api/chats/{direct_chat['id']}/messages",
            headers=alice["headers"],
            json={"content": "ping from the other chat"},
        )

        frame = _drain_until(bob_ws, "message")
        assert frame["data"]["chat_id"] == direct_chat["id"]
        assert frame["data"]["message"]["content"] == "ping from the other chat"
