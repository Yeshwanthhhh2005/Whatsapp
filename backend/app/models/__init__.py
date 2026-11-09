"""SQLAlchemy models.

Imported for the side effect of registering every table on Base.metadata
before Alembic autogenerate or create_all runs.
"""

from app.models.base import Base, as_aware, utcnow
from app.models.conversation import (
    Conversation,
    ConversationMember,
    ConversationType,
)
from app.models.message import Message, MessageStatus, MessageType
from app.models.user import User

__all__ = [
    "Base",
    "utcnow",
    "as_aware",
    "User",
    "Conversation",
    "ConversationMember",
    "ConversationType",
    "Message",
    "MessageType",
    "MessageStatus",
]
