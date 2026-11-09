from __future__ import annotations

import uuid


# ---------------------------------------------------------------------------
# Chats
# ---------------------------------------------------------------------------


def test_direct_chat_is_named_after_the_other_person(client, alice, bob, direct_chat):
    assert direct_chat["type"] == "direct"
    assert direct_chat["is_group"] is False
    # Alice created it, so she sees Bob's name.
    assert direct_chat["name"] == "Bob"

    from_bob = client.get(
        f"/api/chats/{direct_chat['id']}", headers=bob["headers"]
    ).json()
    assert from_bob["name"] == "Alice"


def test_creating_the_same_direct_chat_twice_reuses_it(client, alice, bob, direct_chat):
    again = client.post(
        "/api/chats",
        headers=alice["headers"],
        json={"type": "direct", "member_ids": [bob["id"]]},
    )
    # 200, not 201 -- nothing was created.
    assert again.status_code == 200, again.text
    assert again.json()["id"] == direct_chat["id"]

    # And from the other side too.
    reverse = client.post(
        "/api/chats",
        headers=bob["headers"],
        json={"type": "direct", "member_ids": [alice["id"]]},
    )
    assert reverse.status_code == 200
    assert reverse.json()["id"] == direct_chat["id"]


def test_direct_chat_with_self_is_rejected(client, alice):
    response = client.post(
        "/api/chats",
        headers=alice["headers"],
        json={"type": "direct", "member_ids": [alice["id"]]},
    )
    assert response.status_code == 400


def test_group_chat_requires_a_name(client, alice, bob):
    response = client.post(
        "/api/chats",
        headers=alice["headers"],
        json={"type": "group", "member_ids": [bob["id"]]},
    )
    assert response.status_code == 422


def test_group_chat_creation(client, alice, bob, make_user):
    carol = make_user("Carol")
    response = client.post(
        "/api/chats",
        headers=alice["headers"],
        json={
            "type": "group",
            "name": "Studio people",
            "member_ids": [bob["id"], carol["id"]],
        },
    )
    assert response.status_code == 201, response.text
    chat = response.json()
    assert chat["name"] == "Studio people"
    assert chat["is_group"] is True
    assert len(chat["members"]) == 3
    creator = next(m for m in chat["members"] if m["user"]["id"] == alice["id"])
    assert creator["is_admin"] is True


def test_chat_with_unknown_member_is_rejected(client, alice):
    response = client.post(
        "/api/chats",
        headers=alice["headers"],
        json={"type": "direct", "member_ids": [str(uuid.uuid4())]},
    )
    assert response.status_code == 400


def test_non_member_cannot_see_a_chat(client, direct_chat, make_user):
    outsider = make_user("Outsider")
    response = client.get(
        f"/api/chats/{direct_chat['id']}", headers=outsider["headers"]
    )
    # 404, not 403 -- existence is not disclosed.
    assert response.status_code == 404


def test_chat_list_shows_last_message_and_unread_count(
    client, alice, bob, direct_chat
):
    client.post(
        f"/api/chats/{direct_chat['id']}/messages",
        headers=bob["headers"],
        json={"content": "Are we still on for Saturday?"},
    )

    chats = client.get("/api/chats", headers=alice["headers"]).json()
    chat = next(c for c in chats if c["id"] == direct_chat["id"])
    assert chat["last_message"]["content"] == "Are we still on for Saturday?"
    assert chat["last_message_at"] is not None
    assert chat["unread_count"] == 1

    # Bob sent it, so it is not unread for him.
    bob_chats = client.get("/api/chats", headers=bob["headers"]).json()
    assert next(c for c in bob_chats if c["id"] == direct_chat["id"])["unread_count"] == 0


# ---------------------------------------------------------------------------
# Messages
# ---------------------------------------------------------------------------


def test_send_and_list_messages(client, alice, direct_chat):
    sent = client.post(
        f"/api/chats/{direct_chat['id']}/messages",
        headers=alice["headers"],
        json={"content": "Little Fern Books"},
    )
    assert sent.status_code == 201, sent.text
    body = sent.json()
    assert body["chat_id"] == direct_chat["id"]
    assert body["status"] == "sent"
    assert body["is_read"] is False
    assert body["is_deleted"] is False

    page = client.get(
        f"/api/chats/{direct_chat['id']}/messages", headers=alice["headers"]
    ).json()
    assert [m["content"] for m in page["items"]] == ["Little Fern Books"]
    assert page["has_more"] is False
    assert page["next_cursor"] is None


def test_empty_text_message_is_rejected(client, alice, direct_chat):
    response = client.post(
        f"/api/chats/{direct_chat['id']}/messages",
        headers=alice["headers"],
        json={"content": "   "},
    )
    assert response.status_code == 422


def test_image_message_requires_a_file_url(client, alice, direct_chat):
    response = client.post(
        f"/api/chats/{direct_chat['id']}/messages",
        headers=alice["headers"],
        json={"message_type": "image", "content": "look at this"},
    )
    assert response.status_code == 422


def test_non_member_cannot_post(client, direct_chat, make_user):
    outsider = make_user("Outsider")
    response = client.post(
        f"/api/chats/{direct_chat['id']}/messages",
        headers=outsider["headers"],
        json={"content": "let me in"},
    )
    assert response.status_code == 404


def test_pagination_is_stable_and_newest_first(client, alice, direct_chat):
    for index in range(7):
        client.post(
            f"/api/chats/{direct_chat['id']}/messages",
            headers=alice["headers"],
            json={"content": f"message {index}"},
        )

    first = client.get(
        f"/api/chats/{direct_chat['id']}/messages",
        headers=alice["headers"],
        params={"limit": 3},
    ).json()
    assert [m["content"] for m in first["items"]] == [
        "message 6",
        "message 5",
        "message 4",
    ]
    assert first["has_more"] is True
    assert first["next_cursor"] == first["items"][-1]["id"]

    second = client.get(
        f"/api/chats/{direct_chat['id']}/messages",
        headers=alice["headers"],
        params={"limit": 3, "before": first["next_cursor"]},
    ).json()
    assert [m["content"] for m in second["items"]] == [
        "message 3",
        "message 2",
        "message 1",
    ]

    # No overlap between pages.
    assert not {m["id"] for m in first["items"]} & {m["id"] for m in second["items"]}


def test_edit_message(client, alice, direct_chat):
    message = client.post(
        f"/api/chats/{direct_chat['id']}/messages",
        headers=alice["headers"],
        json={"content": "teh bookshop"},
    ).json()

    edited = client.patch(
        f"/api/messages/{message['id']}",
        headers=alice["headers"],
        json={"content": "the bookshop"},
    )
    assert edited.status_code == 200, edited.text
    assert edited.json()["content"] == "the bookshop"
    assert edited.json()["edited_at"] is not None


def test_only_the_sender_can_edit_or_delete(client, alice, bob, direct_chat):
    message = client.post(
        f"/api/chats/{direct_chat['id']}/messages",
        headers=alice["headers"],
        json={"content": "mine"},
    ).json()

    assert (
        client.patch(
            f"/api/messages/{message['id']}",
            headers=bob["headers"],
            json={"content": "hijacked"},
        ).status_code
        == 403
    )
    assert (
        client.delete(
            f"/api/messages/{message['id']}", headers=bob["headers"]
        ).status_code
        == 403
    )


def test_delete_is_a_soft_delete(client, alice, direct_chat):
    message = client.post(
        f"/api/chats/{direct_chat['id']}/messages",
        headers=alice["headers"],
        json={"content": "oops"},
    ).json()

    deleted = client.delete(
        f"/api/messages/{message['id']}", headers=alice["headers"]
    )
    assert deleted.status_code == 200, deleted.text
    assert deleted.json()["is_deleted"] is True
    assert deleted.json()["content"] is None

    # Still present in history, as a tombstone.
    page = client.get(
        f"/api/chats/{direct_chat['id']}/messages", headers=alice["headers"]
    ).json()
    tombstone = next(m for m in page["items"] if m["id"] == message["id"])
    assert tombstone["is_deleted"] is True


def test_deleted_messages_do_not_count_as_unread(client, alice, bob, direct_chat):
    message = client.post(
        f"/api/chats/{direct_chat['id']}/messages",
        headers=bob["headers"],
        json={"content": "never mind"},
    ).json()

    chats = client.get("/api/chats", headers=alice["headers"]).json()
    assert next(c for c in chats if c["id"] == direct_chat["id"])["unread_count"] == 1

    client.delete(f"/api/messages/{message['id']}", headers=bob["headers"])

    chats = client.get("/api/chats", headers=alice["headers"]).json()
    assert next(c for c in chats if c["id"] == direct_chat["id"])["unread_count"] == 0


# ---------------------------------------------------------------------------
# Read receipts
# ---------------------------------------------------------------------------


def test_marking_read_clears_unread_and_flips_status(client, alice, bob, direct_chat):
    message = client.post(
        f"/api/chats/{direct_chat['id']}/messages",
        headers=bob["headers"],
        json={"content": "did you get home okay?"},
    ).json()
    assert message["is_read"] is False

    read = client.post(
        f"/api/chats/{direct_chat['id']}/read", headers=alice["headers"], json={}
    )
    assert read.status_code == 200, read.text
    assert message["id"] in read.json()["message_ids"]

    chats = client.get("/api/chats", headers=alice["headers"]).json()
    assert next(c for c in chats if c["id"] == direct_chat["id"])["unread_count"] == 0

    # Bob now sees his own message as read -- the blue double tick.
    page = client.get(
        f"/api/chats/{direct_chat['id']}/messages", headers=bob["headers"]
    ).json()
    updated = next(m for m in page["items"] if m["id"] == message["id"])
    assert updated["status"] == "read"
    assert updated["is_read"] is True


def test_marking_read_does_not_affect_your_own_messages(client, alice, direct_chat):
    client.post(
        f"/api/chats/{direct_chat['id']}/messages",
        headers=alice["headers"],
        json={"content": "mine, unread by anyone"},
    )
    read = client.post(
        f"/api/chats/{direct_chat['id']}/read", headers=alice["headers"], json={}
    ).json()
    assert read["message_ids"] == []


def test_sending_a_message_marks_the_chat_read(client, alice, bob, direct_chat):
    client.post(
        f"/api/chats/{direct_chat['id']}/messages",
        headers=bob["headers"],
        json={"content": "you there?"},
    )
    client.post(
        f"/api/chats/{direct_chat['id']}/messages",
        headers=alice["headers"],
        json={"content": "here now"},
    )
    chats = client.get("/api/chats", headers=alice["headers"]).json()
    assert next(c for c in chats if c["id"] == direct_chat["id"])["unread_count"] == 0


def test_read_watermark_never_moves_backwards(client, alice, bob, direct_chat):
    first = client.post(
        f"/api/chats/{direct_chat['id']}/messages",
        headers=bob["headers"],
        json={"content": "one"},
    ).json()
    client.post(
        f"/api/chats/{direct_chat['id']}/messages",
        headers=bob["headers"],
        json={"content": "two"},
    )

    # Read everything, then replay a stale receipt for the older message.
    client.post(
        f"/api/chats/{direct_chat['id']}/read", headers=alice["headers"], json={}
    )
    client.post(
        f"/api/chats/{direct_chat['id']}/read",
        headers=alice["headers"],
        json={"up_to_message_id": first["id"]},
    )

    chats = client.get("/api/chats", headers=alice["headers"]).json()
    assert next(c for c in chats if c["id"] == direct_chat["id"])["unread_count"] == 0


# ---------------------------------------------------------------------------
# Upload
# ---------------------------------------------------------------------------


def test_upload_image_then_send_it(client, alice, direct_chat):
    # A one-pixel PNG.
    png = bytes.fromhex(
        "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4"
        "890000000a49444154789c6300010000050001" "0d0a2db4000000004945" "4e44ae426082"
    )
    upload = client.post(
        "/api/upload",
        headers=alice["headers"],
        files={"file": ("photo.png", png, "image/png")},
    )
    assert upload.status_code == 201, upload.text
    stored = upload.json()
    assert stored["message_type"] == "image"
    assert stored["file_name"] == "photo.png"
    assert stored["url"].startswith("http://testserver/uploads/")
    assert stored["file_size"] == len(png)

    sent = client.post(
        f"/api/chats/{direct_chat['id']}/messages",
        headers=alice["headers"],
        json={
            "message_type": "image",
            "file_url": stored["url"],
            "file_name": stored["file_name"],
            "file_size": stored["file_size"],
            "content": "the light at 5pm",
        },
    )
    assert sent.status_code == 201, sent.text
    assert sent.json()["file_url"] == stored["url"]


def test_upload_rejects_disallowed_content_type(client, alice):
    response = client.post(
        "/api/upload",
        headers=alice["headers"],
        files={"file": ("run.sh", b"#!/bin/sh\nrm -rf /\n", "application/x-sh")},
    )
    assert response.status_code == 400


def test_upload_strips_path_traversal_from_the_display_name(client, alice):
    response = client.post(
        "/api/upload",
        headers=alice["headers"],
        files={"file": ("../../../etc/passwd.txt", b"not really", "text/plain")},
    )
    assert response.status_code == 201, response.text
    assert response.json()["file_name"] == "passwd.txt"


def test_upload_requires_authentication(client):
    response = client.post(
        "/api/upload", files={"file": ("a.txt", b"hello", "text/plain")}
    )
    assert response.status_code == 401
