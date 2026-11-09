"""Aggregates every HTTP router under a single /api prefix."""

from fastapi import APIRouter

from app.routes import auth, chats, messages, upload, users

api_router = APIRouter(prefix="/api")
api_router.include_router(auth.router)
api_router.include_router(users.router)
api_router.include_router(chats.router)
api_router.include_router(messages.router)
api_router.include_router(upload.router)

__all__ = ["api_router"]
