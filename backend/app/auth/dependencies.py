"""Auth dependencies for HTTP routes, plus the WebSocket equivalent."""

from __future__ import annotations

from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.security import InvalidTokenError, decode_access_token
from app.database import get_db
from app.models import User
from app.services import user_service

# auto_error=False so a missing header produces our own 401 with a
# WWW-Authenticate challenge rather than Starlette's bare 403.
bearer_scheme = HTTPBearer(auto_error=False, description="JWT access token")

_UNAUTHORIZED = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Not authenticated.",
    headers={"WWW-Authenticate": "Bearer"},
)


async def get_current_user(
    credentials: Annotated[
        HTTPAuthorizationCredentials | None, Depends(bearer_scheme)
    ] = None,
    db: AsyncSession = Depends(get_db),
) -> User:
    if credentials is None or not credentials.credentials:
        raise _UNAUTHORIZED

    try:
        user_id = decode_access_token(credentials.credentials)
    except InvalidTokenError:
        raise _UNAUTHORIZED from None

    user = await user_service.get_by_id(db, user_id)
    if user is None:
        # Valid signature, but the account is gone.
        raise _UNAUTHORIZED
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


async def authenticate_websocket(db: AsyncSession, token: str | None) -> User | None:
    """Resolve a WebSocket query-string token to a user, or None.

    Browsers cannot set headers on a WebSocket handshake, so the token arrives
    as ?token=... . Returns None rather than raising; the caller closes the
    socket with an explicit code.
    """
    if not token:
        return None
    try:
        user_id = decode_access_token(token)
    except InvalidTokenError:
        return None
    return await user_service.get_by_id(db, user_id)
