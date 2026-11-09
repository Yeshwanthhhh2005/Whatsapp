from __future__ import annotations

import uuid


def test_register_returns_token_and_user(client):
    email = f"{uuid.uuid4().hex[:12]}@example.com"
    response = client.post(
        "/api/auth/register",
        json={"name": "Maya Chen", "email": email, "password": "a good passphrase"},
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["token_type"] == "bearer"
    assert body["access_token"]
    assert body["user"]["email"] == email
    assert body["user"]["name"] == "Maya Chen"
    # The hash must never leave the server.
    assert "password_hash" not in body["user"]
    assert "password" not in body["user"]


def test_register_rejects_duplicate_email(client, alice):
    response = client.post(
        "/api/auth/register",
        json={"name": "Impostor", "email": alice["email"], "password": "another one"},
    )
    assert response.status_code == 409


def test_register_rejects_short_password(client):
    response = client.post(
        "/api/auth/register",
        json={
            "name": "Shorty",
            "email": f"{uuid.uuid4().hex[:12]}@example.com",
            "password": "short",
        },
    )
    assert response.status_code == 422


def test_register_rejects_password_over_bcrypt_byte_limit(client):
    # 30 four-byte characters = 120 bytes, under Pydantic's character cap but
    # over what bcrypt will actually hash.
    response = client.post(
        "/api/auth/register",
        json={
            "name": "Long",
            "email": f"{uuid.uuid4().hex[:12]}@example.com",
            "password": "\U0001f600" * 30,
        },
    )
    assert response.status_code == 422


def test_login_succeeds_and_me_matches(client, alice):
    response = client.post(
        "/api/auth/login",
        json={"email": alice["email"], "password": "correct horse battery"},
    )
    assert response.status_code == 200, response.text
    token = response.json()["access_token"]

    me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200
    assert me.json()["id"] == alice["id"]


def test_login_is_case_insensitive_on_email(client, alice):
    response = client.post(
        "/api/auth/login",
        json={
            "email": alice["email"].upper(),
            "password": "correct horse battery",
        },
    )
    assert response.status_code == 200


def test_login_rejects_wrong_password(client, alice):
    response = client.post(
        "/api/auth/login",
        json={"email": alice["email"], "password": "not the password"},
    )
    assert response.status_code == 401


def test_login_does_not_reveal_whether_account_exists(client, alice):
    unknown = client.post(
        "/api/auth/login",
        json={"email": "nobody@example.com", "password": "whatever you like"},
    )
    wrong_password = client.post(
        "/api/auth/login",
        json={"email": alice["email"], "password": "whatever you like"},
    )
    assert unknown.status_code == wrong_password.status_code == 401
    assert unknown.json()["detail"] == wrong_password.json()["detail"]


def test_protected_route_requires_a_token(client):
    assert client.get("/api/auth/me").status_code == 401
    assert (
        client.get(
            "/api/auth/me", headers={"Authorization": "Bearer not-a-real-token"}
        ).status_code
        == 401
    )


def test_patch_me_updates_only_given_fields(client, alice):
    response = client.patch(
        "/api/users/me", headers=alice["headers"], json={"about": "Out walking"}
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["about"] == "Out walking"
    assert body["name"] == "Alice"  # untouched


def test_user_search_finds_by_name_and_shows_email(client, alice, bob):
    """Search returns the email on purpose.

    Two people can register the same display name; the email is the only thing
    that distinguishes them when choosing who to message, and picking the wrong
    one looks exactly like chatting with yourself.
    """
    response = client.get(
        "/api/users/search", headers=alice["headers"], params={"q": "Bob"}
    )
    assert response.status_code == 200, response.text
    results = response.json()
    assert [user["id"] for user in results] == [bob["id"]]
    assert results[0]["email"] == bob["email"]


def test_chat_members_still_do_not_leak_email(client, alice, direct_chat):
    """The wider API keeps using UserPublic, which has no email."""
    chat = client.get(
        f"/api/chats/{direct_chat['id']}", headers=alice["headers"]
    ).json()
    for member in chat["members"]:
        assert "email" not in member["user"]


def test_user_search_matches_exact_email(client, alice, bob):
    response = client.get(
        "/api/users/search", headers=alice["headers"], params={"q": bob["email"]}
    )
    assert [user["id"] for user in response.json()] == [bob["id"]]


def test_user_search_excludes_self(client, alice):
    response = client.get(
        "/api/users/search", headers=alice["headers"], params={"q": "Alice"}
    )
    assert all(user["id"] != alice["id"] for user in response.json())
