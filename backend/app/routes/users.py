from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import CurrentUser
from app.database import get_db
from app.schemas.user import UserMe, UserSearchResult, UserUpdate
from app.services import user_service

router = APIRouter(prefix="/users", tags=["users"])


@router.get("/me", response_model=UserMe, summary="Own profile")
async def read_me(current_user: CurrentUser) -> UserMe:
    return UserMe.model_validate(current_user)


@router.patch("/me", response_model=UserMe, summary="Update own profile")
async def update_me(
    payload: UserUpdate,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
) -> UserMe:
    user = await user_service.update_profile(db, current_user, payload)
    return UserMe.model_validate(user)


@router.get(
    "/search",
    response_model=list[UserSearchResult],
    summary="Find people to start a chat with",
    description=(
        "Matches a partial name or an exact email address. Results include the "
        "email, because two people can share a display name and it is the only "
        "way to tell them apart when picking who to message."
    ),
)
async def search_users(
    current_user: CurrentUser,
    q: str = Query(min_length=2, max_length=120, description="Name or exact email"),
    limit: int = Query(default=20, ge=1, le=50),
    db: AsyncSession = Depends(get_db),
) -> list[UserSearchResult]:
    users = await user_service.search(db, current_user, q, limit=limit)
    return [UserSearchResult.model_validate(user) for user in users]
