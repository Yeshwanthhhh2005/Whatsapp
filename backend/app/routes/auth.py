from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import CurrentUser
from app.auth.security import create_access_token
from app.database import get_db
from app.schemas.auth import LoginRequest, RegisterRequest, TokenResponse
from app.schemas.user import UserMe
from app.services import user_service

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post(
    "/register",
    response_model=TokenResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create an account and sign in",
)
async def register(
    payload: RegisterRequest, db: AsyncSession = Depends(get_db)
) -> TokenResponse:
    try:
        user = await user_service.register(
            db, name=payload.name, email=payload.email, password=payload.password
        )
    except user_service.EmailAlreadyRegistered:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="That email address is already registered.",
        ) from None

    return TokenResponse(
        access_token=create_access_token(user.id),
        user=UserMe.model_validate(user),
    )


@router.post("/login", response_model=TokenResponse, summary="Sign in")
async def login(
    payload: LoginRequest, db: AsyncSession = Depends(get_db)
) -> TokenResponse:
    user = await user_service.authenticate(db, payload.email, payload.password)
    if user is None:
        # One message for both "no such account" and "wrong password", so the
        # endpoint cannot be used to enumerate registered addresses.
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return TokenResponse(
        access_token=create_access_token(user.id),
        user=UserMe.model_validate(user),
    )


@router.get("/me", response_model=UserMe, summary="The signed-in user")
async def read_me(current_user: CurrentUser) -> UserMe:
    return UserMe.model_validate(current_user)
