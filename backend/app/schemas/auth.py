from __future__ import annotations

from typing import Annotated

from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    EmailStr,
    Field,
)

from app.auth.security import MAX_PASSWORD_BYTES
from app.schemas.user import UserMe


def _within_bcrypt_limit(value: str) -> str:
    """bcrypt ignores everything past 72 *bytes*.

    Pydantic's max_length counts characters, so a 70-character password of
    multi-byte characters can still overflow. Checking the encoded length here
    means a too-long password is a 422 rather than a 500 -- and never a
    silently truncated hash that makes two different passwords equivalent.
    """
    if len(value.encode("utf-8")) > MAX_PASSWORD_BYTES:
        raise ValueError(
            f"Password must be at most {MAX_PASSWORD_BYTES} bytes when UTF-8 encoded."
        )
    return value


Password = Annotated[
    str,
    Field(min_length=8, max_length=MAX_PASSWORD_BYTES),
    AfterValidator(_within_bcrypt_limit),
]


class RegisterRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=80)
    email: EmailStr
    password: Password


class LoginRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: EmailStr
    # No min_length: a short wrong password should fail authentication, not
    # validation, so the error does not leak policy details.
    password: str = Field(max_length=MAX_PASSWORD_BYTES * 4)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserMe
