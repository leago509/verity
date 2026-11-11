"""Background jobs. The worker runs these, not the API.

For now the pipeline is a single placeholder step that marks the meeting done.
Each AI stage (transcribe, speakers, index, summarise, verify) will be added to
process_meeting one at a time, updating Meeting.status as it goes:

    uploaded -> transcribing -> diarizing -> indexing -> summarising -> verifying -> done
"""

import logging

from .celery_app import celery_app
from .db import SessionLocal
from .models import Meeting

log = logging.getLogger(__name__)


def set_status(db, meeting: Meeting, status: str, error: str | None = None) -> None:
    meeting.status = status
    meeting.error = error
    db.commit()
    log.info("meeting %s -> %s", meeting.id, status)


@celery_app.task(name="process_meeting")
def process_meeting(meeting_id: int) -> None:
    db = SessionLocal()
    try:
        meeting = db.get(Meeting, meeting_id)
        if meeting is None:
            log.warning("meeting %s no longer exists, skipping", meeting_id)
            return

        set_status(db, meeting, "processing")

        # --- AI stages will be added here, one at a time ---

        set_status(db, meeting, "done")
    except Exception as exc:
        db.rollback()
        meeting = db.get(Meeting, meeting_id)
        if meeting is not None:
            set_status(db, meeting, "failed", error=str(exc)[:1000])
        raise
    finally:
        db.close()
