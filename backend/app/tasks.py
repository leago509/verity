"""Background jobs. The worker runs these, not the API.

For now the pipeline is a single placeholder step that marks the meeting done.
Each AI stage (transcribe, speakers, index, summarise, verify) will be added to
process_meeting one at a time, updating Meeting.status as it goes:

    uploaded -> transcribing -> diarizing -> indexing -> summarising -> verifying -> done
"""

import logging
import os
import uuid
from datetime import timedelta
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from . import google_api
from .celery_app import celery_app
from .db import SessionLocal
from .models import GoogleConnection, Meeting, RecordingIngestion

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


# ---------------------------------------------------------------------------
# Google Meet ingestion
#
# A recording can be reported twice (push event AND polling). RecordingIngestion.recording_name
# is unique, so it is only ever imported once. Polling is the safety net: if a push event is
# lost, or Pub/Sub is not set up at all, reconcile_google_meet still finds the recording.
# ---------------------------------------------------------------------------

UPLOAD_DIR = Path(os.environ.get("UPLOAD_DIR", "/data/uploads"))
RECONCILE_LOOKBACK_DAYS = int(os.environ.get("GOOGLE_RECONCILE_LOOKBACK_DAYS", "3"))


def _mark_revoked(db, conn: GoogleConnection, exc: Exception) -> None:
    conn.status = "revoked"
    conn.last_error = f"Google access was revoked or expired - please reconnect. ({exc})"[:1000]
    db.commit()
    log.warning("google connection %s revoked: %s", conn.id, exc)


def _queue_ingestion(db, conn: GoogleConnection, recording: dict) -> None:
    name = recording["name"]
    if db.scalar(select(RecordingIngestion.id).where(RecordingIngestion.recording_name == name)):
        return
    ing = RecordingIngestion(
        user_id=conn.user_id,
        recording_name=name,
        drive_file_id=(recording.get("driveDestination") or {}).get("file"),
    )
    db.add(ing)
    try:
        db.commit()
    except IntegrityError:  # another worker queued it first
        db.rollback()
        return
    ingest_recording.delay(ing.id)


@celery_app.task(name="handle_recording_event")
def handle_recording_event(recording_name: str) -> None:
    """A push event told us a recording exists. Find which connected account owns it."""
    db = SessionLocal()
    try:
        for conn in db.scalars(select(GoogleConnection).where(GoogleConnection.status == "active")):
            try:
                token = google_api.access_token(conn)
            except google_api.GoogleAuthError as exc:
                _mark_revoked(db, conn, exc)
                continue
            recording = google_api.get_recording(token, recording_name)
            if recording:  # None means this account cannot see it
                _queue_ingestion(db, conn, recording)
                return
        log.info("no connected account can see %s", recording_name)
    finally:
        db.close()


@celery_app.task(name="reconcile_google_meet")
def reconcile_google_meet(user_id: int | None = None) -> None:
    """Polls Meet for recent finished recordings. Runs on a schedule and on demand."""
    db = SessionLocal()
    try:
        query = select(GoogleConnection).where(GoogleConnection.status == "active")
        if user_id is not None:
            query = query.where(GoogleConnection.user_id == user_id)
        since = google_api.now() - timedelta(days=RECONCILE_LOOKBACK_DAYS)
        for conn in db.scalars(query):
            try:
                token = google_api.access_token(conn)
                for conference in google_api.list_conferences(token, since):
                    for rec in google_api.list_recordings(token, conference["name"]):
                        if rec.get("state") == "FILE_GENERATED":
                            _queue_ingestion(db, conn, rec)
            except google_api.GoogleAuthError as exc:
                _mark_revoked(db, conn, exc)
            except Exception:
                db.rollback()
                log.exception("reconcile failed for connection %s", conn.id)
    finally:
        db.close()


@celery_app.task(name="renew_google_subscriptions")
def renew_google_subscriptions() -> None:
    """Creates / renews Workspace Events subscriptions. No-op without GOOGLE_PUBSUB_TOPIC."""
    if not google_api.PUBSUB_TOPIC:
        return
    db = SessionLocal()
    try:
        for conn in db.scalars(select(GoogleConnection).where(GoogleConnection.status == "active")):
            due = (
                conn.subscription_name is None
                or conn.subscription_expires_at is None
                or conn.subscription_expires_at < google_api.soon(24)
            )
            if not due:
                continue
            try:
                token = google_api.access_token(conn)
                if conn.subscription_name:
                    conn.subscription_expires_at = google_api.renew_subscription(
                        token, conn.subscription_name
                    )
                else:
                    sub = google_api.create_subscription(token, conn.google_email)
                    conn.subscription_name = sub["name"]
                    conn.subscription_expires_at = sub["expire_time"]
                db.commit()
            except google_api.GoogleAuthError as exc:
                _mark_revoked(db, conn, exc)
            except Exception as exc:  # polling still covers us
                db.rollback()
                conn.last_error = f"Push subscription failed: {exc}"[:1000]
                db.commit()
                log.exception("subscription failed for connection %s", conn.id)
    finally:
        db.close()


@celery_app.task(name="ingest_recording", bind=True, max_retries=6)
def ingest_recording(self, ingestion_id: int) -> None:
    """Downloads one Meet recording from Drive, then hands it to the normal pipeline."""
    db = SessionLocal()
    try:
        ing = db.get(RecordingIngestion, ingestion_id)
        if ing is None or ing.status == "done":
            return
        conn = db.scalar(select(GoogleConnection).where(GoogleConnection.user_id == ing.user_id))
        if conn is None or conn.status != "active":
            ing.status, ing.error = "failed", "Google account is not connected"
            db.commit()
            return

        try:
            token = google_api.access_token(conn)
        except google_api.GoogleAuthError as exc:
            _mark_revoked(db, conn, exc)
            ing.status, ing.error = "failed", "Google access revoked"
            db.commit()
            return

        recording = google_api.get_recording(token, ing.recording_name)
        file_id = ((recording or {}).get("driveDestination") or {}).get("file")
        if not recording or recording.get("state") != "FILE_GENERATED" or not file_id:
            # Google may still be writing the file. Back off: 1, 2, 3 ... minutes.
            raise self.retry(countdown=60 * (self.request.retries + 1))

        ing.drive_file_id = file_id
        started = google_api._parse_time(recording.get("startTime"))
        meeting = Meeting(
            owner_id=ing.user_id,
            title=f"Google Meet {started:%Y-%m-%d %H:%M}" if started else "Google Meet recording",
            original_filename=f"{ing.recording_name.split('/')[-1]}.mp4",
            status="downloading",
            source="google_meet",
            meeting_date=started,
            external_id=ing.recording_name,
        )
        db.add(meeting)
        db.commit()
        ing.meeting_id = meeting.id
        db.commit()

        user_dir = UPLOAD_DIR / str(ing.user_id)
        user_dir.mkdir(parents=True, exist_ok=True)
        dest = user_dir / f"{uuid.uuid4().hex}.mp4"
        try:
            size = google_api.download_drive_file(token, file_id, dest)
            if size == 0:
                raise RuntimeError("Downloaded file is empty")
        except Exception as exc:
            dest.unlink(missing_ok=True)
            set_status(db, meeting, "failed", error=f"Could not download recording: {exc}"[:1000])
            ing.status, ing.error = "failed", str(exc)[:1000]
            db.commit()
            return

        meeting.file_path = str(dest)
        set_status(db, meeting, "uploaded")
        ing.status = "done"
        db.commit()
        process_meeting.delay(meeting.id)
    finally:
        db.close()
