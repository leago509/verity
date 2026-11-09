import os
import uuid
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from .auth import get_current_user
from .db import get_db
from .models import Meeting, User
from .tasks import process_meeting

UPLOAD_DIR = Path(os.environ.get("UPLOAD_DIR", "/data/uploads"))
MAX_UPLOAD_MB = int(os.environ.get("MAX_UPLOAD_MB", "500"))
ALLOWED_EXTENSIONS = {
    ".mp3", ".wav", ".m4a", ".flac", ".ogg", ".aac",
    ".mp4", ".mkv", ".mov", ".webm",
}
CHUNK = 1024 * 1024  # read uploads 1 MB at a time

router = APIRouter(prefix="/meetings", tags=["meetings"])


class MeetingOut(BaseModel):
    id: int
    title: str
    original_filename: str | None
    status: str
    error: str | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


def get_own_meeting(db: Session, user: User, meeting_id: int) -> Meeting:
    meeting = db.get(Meeting, meeting_id)
    # 404 (not 403) for other people's meetings, so ids can't be probed
    if meeting is None or meeting.owner_id != user.id:
        raise HTTPException(status_code=404, detail="Meeting not found")
    return meeting


@router.get("", response_model=list[MeetingOut])
def list_meetings(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """The logged-in user's meetings, newest first."""
    return db.scalars(
        select(Meeting)
        .where(Meeting.owner_id == user.id)
        .order_by(Meeting.created_at.desc(), Meeting.id.desc())
    ).all()


@router.post("", response_model=MeetingOut, status_code=status.HTTP_202_ACCEPTED)
def upload_meeting(
    file: UploadFile = File(...),
    title: str | None = Form(None),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Saves the recording, creates the meeting and queues it for processing.

    Returns immediately with status "uploaded". Poll GET /meetings/{id} for progress.
    """
    original = os.path.basename(file.filename or "")
    suffix = Path(original).suffix.lower()
    if suffix not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=415,
            detail=f"Unsupported file type '{suffix}'. Allowed: {', '.join(sorted(ALLOWED_EXTENSIONS))}",
        )

    user_dir = UPLOAD_DIR / str(user.id)
    user_dir.mkdir(parents=True, exist_ok=True)
    dest = user_dir / f"{uuid.uuid4().hex}{suffix}"

    limit = MAX_UPLOAD_MB * 1024 * 1024
    written = 0
    try:
        with open(dest, "wb") as out:
            while chunk := file.file.read(CHUNK):
                written += len(chunk)
                if written > limit:
                    raise HTTPException(
                        status_code=413, detail=f"File too large (max {MAX_UPLOAD_MB} MB)"
                    )
                out.write(chunk)
        if written == 0:
            raise HTTPException(status_code=400, detail="File is empty")
    except BaseException:
        dest.unlink(missing_ok=True)
        raise

    meeting = Meeting(
        owner_id=user.id,
        title=(title or "").strip() or Path(original).stem or "Untitled meeting",
        original_filename=original,
        file_path=str(dest),
        status="uploaded",
    )
    db.add(meeting)
    db.commit()

    try:
        process_meeting.delay(meeting.id)
    except Exception as exc:  # Redis unreachable, etc.
        meeting.status = "failed"
        meeting.error = f"Could not queue job: {exc}"[:1000]
        db.commit()
        raise HTTPException(status_code=503, detail="Could not queue processing job")

    return meeting


@router.get("/{meeting_id}", response_model=MeetingOut)
def get_meeting(
    meeting_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    return get_own_meeting(db, user, meeting_id)
