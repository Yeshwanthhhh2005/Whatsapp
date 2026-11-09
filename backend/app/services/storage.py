"""File storage behind a tiny interface.

Only `LocalStorage` exists today. Swapping in S3 or Cloudinary later means
writing one more `Storage` subclass and changing `get_storage()` -- nothing in
the routes or services needs to know which one is active.
"""

from __future__ import annotations

import uuid
from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from fastapi import UploadFile

from app.config import get_settings
from app.models.message import MessageType

# Allowlist, not a blocklist. The extension comes from this table rather than
# from the client-supplied filename, so an upload cannot choose its own.
ALLOWED_TYPES: dict[str, tuple[str, MessageType]] = {
    "image/jpeg": (".jpg", MessageType.image),
    "image/png": (".png", MessageType.image),
    "image/gif": (".gif", MessageType.image),
    "image/webp": (".webp", MessageType.image),
    "application/pdf": (".pdf", MessageType.document),
    "text/plain": (".txt", MessageType.document),
    "application/msword": (".doc", MessageType.document),
    (
        "application/vnd.openxmlformats-officedocument"
        ".wordprocessingml.document"
    ): (".docx", MessageType.document),
    "application/vnd.ms-excel": (".xls", MessageType.document),
    (
        "application/vnd.openxmlformats-officedocument"
        ".spreadsheetml.sheet"
    ): (".xlsx", MessageType.document),
    "application/zip": (".zip", MessageType.document),
}

CHUNK_SIZE = 1024 * 1024


class UploadRejected(Exception):
    """Unsupported media type or oversized file."""


@dataclass(frozen=True)
class StoredFile:
    url: str
    file_name: str
    content_type: str
    file_size: int
    message_type: MessageType


class Storage(ABC):
    @abstractmethod
    async def save(self, upload: UploadFile) -> StoredFile:
        """Persist `upload` and return where it can be fetched from."""


def _safe_display_name(raw: str | None, extension: str) -> str:
    """A filename safe to echo back to clients.

    Only the basename is kept and path separators are dropped, so a crafted
    name like ../../etc/passwd cannot escape anywhere -- neither on disk (the
    stored name is a fresh UUID) nor in the UI.
    """
    candidate = Path(raw or "").name.strip()
    candidate = candidate.replace("\\", "").replace("/", "")
    if not candidate:
        candidate = f"file{extension}"
    return candidate[:255]


class LocalStorage(Storage):
    """Writes under `UPLOAD_DIR`, served by the /uploads static mount."""

    def __init__(self, root: Path, public_base_url: str, max_bytes: int) -> None:
        self._root = root
        self._public_base_url = public_base_url.rstrip("/")
        self._max_bytes = max_bytes

    async def save(self, upload: UploadFile) -> StoredFile:
        content_type = (upload.content_type or "").split(";")[0].strip().lower()
        if content_type not in ALLOWED_TYPES:
            raise UploadRejected(
                f"Unsupported content type {content_type or 'unknown'!r}. "
                f"Allowed: {', '.join(sorted(ALLOWED_TYPES))}"
            )

        extension, message_type = ALLOWED_TYPES[content_type]
        now = datetime.now(timezone.utc)
        # Date-sharded so one directory never accumulates every upload.
        relative_dir = Path(f"{now:%Y}") / f"{now:%m}"
        target_dir = self._root / relative_dir
        target_dir.mkdir(parents=True, exist_ok=True)

        stored_name = f"{uuid.uuid4().hex}{extension}"
        target_path = target_dir / stored_name

        written = 0
        try:
            with target_path.open("wb") as handle:
                # Streamed in chunks so the size cap is enforced as we go,
                # instead of buffering an arbitrarily large body first.
                while chunk := await upload.read(CHUNK_SIZE):
                    written += len(chunk)
                    if written > self._max_bytes:
                        raise UploadRejected(
                            f"File exceeds the {self._max_bytes // (1024 * 1024)} MB limit."
                        )
                    handle.write(chunk)
        except UploadRejected:
            target_path.unlink(missing_ok=True)
            raise
        except OSError as exc:
            target_path.unlink(missing_ok=True)
            raise UploadRejected(f"Could not store the file: {exc}") from exc

        if written == 0:
            target_path.unlink(missing_ok=True)
            raise UploadRejected("The uploaded file is empty.")

        relative_url = f"/uploads/{relative_dir.as_posix()}/{stored_name}"
        return StoredFile(
            url=f"{self._public_base_url}{relative_url}",
            file_name=_safe_display_name(upload.filename, extension),
            content_type=content_type,
            file_size=written,
            message_type=message_type,
        )


_storage: Storage | None = None


def get_storage() -> Storage:
    """The single swap point. Return a different Storage here for S3/Cloudinary."""
    global _storage
    if _storage is None:
        settings = get_settings()
        _storage = LocalStorage(
            root=settings.upload_path,
            public_base_url=settings.public_base_url,
            max_bytes=settings.max_upload_size_bytes,
        )
    return _storage
