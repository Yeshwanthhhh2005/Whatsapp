"""Reset the development database to exactly two users and one conversation.

Why this exists: registering a few accounts by hand, plus any test run that
creates its own users, leaves behind several people with similar display names.
Searching for "apple" then returns more than one of them, and starting a chat
with the wrong one looks exactly like "I can see myself in my own chat list" --
which is confusing but is a data problem, not a bug in the chat code.

    python scripts/reset_test_users.py

Deletes EVERY row in messages, conversation_members, conversations and users,
then recreates:

    Yesh   yesh@example.com    yesh12345
    Apple  apple@example.com   apple12345

plus the single direct conversation between them.

Development only. It takes no arguments and asks no questions, so do not point
it at anything you care about.
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

# Allow `python scripts/reset_test_users.py` from the backend directory.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import delete, select  # noqa: E402

from app.auth.security import hash_password  # noqa: E402
from app.database import dispose_engine, get_session_factory  # noqa: E402
from app.models import (  # noqa: E402
    Conversation,
    ConversationMember,
    ConversationType,
    Message,
    User,
)

PEOPLE = [
    ("Yesh", "yesh@example.com", "yesh12345"),
    ("Apple", "apple@example.com", "apple12345"),
]


async def main() -> int:
    async with get_session_factory()() as db:
        before = len((await db.execute(select(User))).scalars().all())

        # Children first; SQLite only enforces ON DELETE CASCADE when
        # foreign_keys=ON, so do not rely on it here.
        await db.execute(delete(Message))
        await db.execute(delete(ConversationMember))
        await db.execute(delete(Conversation))
        await db.execute(delete(User))
        await db.commit()
        print(f"Cleared {before} user(s) and all conversations.")

        users = {}
        for name, email, password in PEOPLE:
            user = User(name=name, email=email, password_hash=hash_password(password))
            db.add(user)
            users[name] = user
        await db.commit()
        for user in users.values():
            await db.refresh(user)

        conversation = Conversation(
            type=ConversationType.direct,
            created_by=users["Yesh"].id,
        )
        for user in users.values():
            conversation.members.append(ConversationMember(user_id=user.id))
        db.add(conversation)
        await db.commit()
        await db.refresh(conversation)

        print("\nCreated:")
        for name, email, password in PEOPLE:
            print(f"  {name:6} {email:20} {password}")
        print(f"\nOne shared conversation: {conversation.id}")
        print("  members: " + ", ".join(sorted(users)))

    await dispose_engine()
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
