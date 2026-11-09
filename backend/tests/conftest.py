"""Test fixtures.

The suite runs against SQLite (aiosqlite) rather than PostgreSQL so it needs no
running server. Everything goes through Starlette's `TestClient`, which drives
the app in a single event loop of its own -- including WebSockets -- so the
async engine is only ever touched from one loop.

Tables are created by the app's own lifespan via AUTO_CREATE_TABLES, which
keeps engine creation inside that loop.
"""

from __future__ import annotations

import os
import tempfile
import uuid
from pathlib import Path

import pytest

# Must be set before app.config is imported anywhere.
_TMP = Path(tempfile.mkdtemp(prefix="wa-clone-tests-"))
os.environ.update(
    SECRET_KEY="test-secret-key-not-used-anywhere-real",
    DATABASE_URL=f"sqlite+aiosqlite:///{(_TMP / 'test.db').as_posix()}",
    AUTO_CREATE_TABLES="true",
    UPLOAD_DIR=str(_TMP / "uploads"),
    PUBLIC_BASE_URL="http://testserver",
    ENV="development",
)

from fastapi.testclient import TestClient  # noqa: E402

from app.main import create_app  # noqa: E402


@pytest.fixture(scope="session")
def client():
    with TestClient(create_app()) as test_client:
        yield test_client


@pytest.fixture
def make_user(client):
    """Register a fresh user and return its details plus an auth header."""

    def _make(name: str = "Test User") -> dict:
        email = f"{uuid.uuid4().hex[:12]}@example.com"
        response = client.post(
            "/api/auth/register",
            json={"name": name, "email": email, "password": "correct horse battery"},
        )
        assert response.status_code == 201, response.text
        body = response.json()
        return {
            "id": body["user"]["id"],
            "name": name,
            "email": email,
            "token": body["access_token"],
            "headers": {"Authorization": f"Bearer {body['access_token']}"},
        }

    return _make


@pytest.fixture
def alice(make_user):
    return make_user("Alice")


@pytest.fixture
def bob(make_user):
    return make_user("Bob")


@pytest.fixture
def direct_chat(client, alice, bob):
    """A direct conversation between alice and bob."""
    response = client.post(
        "/api/chats",
        headers=alice["headers"],
        json={"type": "direct", "member_ids": [bob["id"]]},
    )
    assert response.status_code == 201, response.text
    return response.json()
