from __future__ import annotations

from fastapi import APIRouter, File, HTTPException, UploadFile, status

from app.auth.dependencies import CurrentUser
from app.schemas.upload import UploadResponse
from app.services.storage import ALLOWED_TYPES, UploadRejected, get_storage

router = APIRouter(tags=["upload"])


@router.post(
    "/upload",
    response_model=UploadResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Upload an image or document",
    description=(
        "Two-step attachment flow: upload here, then send a message whose "
        "`file_url`, `file_name` and `file_size` come from this response and "
        "whose `message_type` is the returned value.\n\n"
        f"Accepted content types: {', '.join(sorted(ALLOWED_TYPES))}"
    ),
)
async def upload_file(
    current_user: CurrentUser,
    file: UploadFile = File(description="The image or document to store"),
) -> UploadResponse:
    # Requires authentication so the endpoint cannot be used as open storage.
    try:
        stored = await get_storage().save(file)
    except UploadRejected as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
        ) from None
    finally:
        await file.close()

    return UploadResponse(
        url=stored.url,
        file_name=stored.file_name,
        content_type=stored.content_type,
        file_size=stored.file_size,
        message_type=stored.message_type,
    )
