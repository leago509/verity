"""Database tables for Verity.

Pipeline status values for Meeting.status, in order:
  (google_meet meetings start as "downloading" while the recording is fetched from Drive)
  uploaded -> transcribing -> diarizing -> indexing -> summarising -> verifying -> done
  (or "failed", with the reason in Meeting.error)

Statement.kind: "summary" | "decision" | "action_item"
Statement.verdict: "supported" | "partially_supported" | "unsupported" | NULL (not checked yet)
"""

from datetime import datetime, timezone

from sqlalchemy import (
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    hashed_password: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    meetings: Mapped[list["Meeting"]] = relationship(back_populates="owner")


class Meeting(Base):
    __tablename__ = "meetings"

    id: Mapped[int] = mapped_column(primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(255))
    original_filename: Mapped[str | None] = mapped_column(String(255))
    file_path: Mapped[str | None] = mapped_column(String(512))
    duration_seconds: Mapped[float | None] = mapped_column(Float)
    status: Mapped[str] = mapped_column(String(32), default="uploaded", index=True)
    error: Mapped[str | None] = mapped_column(Text)
    # Where the recording came from: "upload" (manual) or "google_meet" (connected account)
    source: Mapped[str] = mapped_column(String(16), default="upload", server_default="upload")
    meeting_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Google Meet recording resource name, e.g. conferenceRecords/abc/recordings/xyz
    external_id: Mapped[str | None] = mapped_column(String(255), unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )

    owner: Mapped["User"] = relationship(back_populates="meetings")
    segments: Mapped[list["TranscriptSegment"]] = relationship(
        back_populates="meeting",
        cascade="all, delete-orphan",
        order_by="TranscriptSegment.idx",
    )
    statements: Mapped[list["Statement"]] = relationship(
        back_populates="meeting", cascade="all, delete-orphan"
    )


class TranscriptSegment(Base):
    """One utterance from the transcript, with timestamps and speaker."""

    __tablename__ = "transcript_segments"
    __table_args__ = (UniqueConstraint("meeting_id", "idx"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    meeting_id: Mapped[int] = mapped_column(
        ForeignKey("meetings.id", ondelete="CASCADE"), index=True
    )
    idx: Mapped[int] = mapped_column(Integer)  # order within the meeting
    start_s: Mapped[float] = mapped_column(Float)
    end_s: Mapped[float] = mapped_column(Float)
    speaker: Mapped[str | None] = mapped_column(String(64))
    text: Mapped[str] = mapped_column(Text)

    meeting: Mapped["Meeting"] = relationship(back_populates="segments")


class Statement(Base):
    """One AI-generated claim (summary line, decision or action item) and its verdict."""

    __tablename__ = "statements"

    id: Mapped[int] = mapped_column(primary_key=True)
    meeting_id: Mapped[int] = mapped_column(
        ForeignKey("meetings.id", ondelete="CASCADE"), index=True
    )
    kind: Mapped[str] = mapped_column(String(32))
    text: Mapped[str] = mapped_column(Text)
    assignee: Mapped[str | None] = mapped_column(String(255))  # action items only
    due: Mapped[str | None] = mapped_column(String(64))  # action items only, free text
    verdict: Mapped[str | None] = mapped_column(String(32), index=True)
    confidence: Mapped[float | None] = mapped_column(Float)

    meeting: Mapped["Meeting"] = relationship(back_populates="statements")
    evidence: Mapped[list["Evidence"]] = relationship(
        back_populates="statement", cascade="all, delete-orphan"
    )


class Evidence(Base):
    """Links a statement to the transcript segments that support (or fail to support) it."""

    __tablename__ = "evidence"

    id: Mapped[int] = mapped_column(primary_key=True)
    statement_id: Mapped[int] = mapped_column(
        ForeignKey("statements.id", ondelete="CASCADE"), index=True
    )
    segment_id: Mapped[int] = mapped_column(
        ForeignKey("transcript_segments.id", ondelete="CASCADE"), index=True
    )
    retrieval_score: Mapped[float | None] = mapped_column(Float)  # similarity from ChromaDB
    entailment_score: Mapped[float | None] = mapped_column(Float)  # NLI probability

    statement: Mapped["Statement"] = relationship(back_populates="evidence")
    segment: Mapped["TranscriptSegment"] = relationship()


class GoogleConnection(Base):
    """A user's linked Google account, used to pull Google Meet recordings."""

    __tablename__ = "google_connections"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), unique=True, index=True
    )
    google_email: Mapped[str] = mapped_column(String(255))
    refresh_token_enc: Mapped[str] = mapped_column(Text)  # encrypted, see crypto.py
    status: Mapped[str] = mapped_column(String(32), default="active")  # active | revoked
    last_error: Mapped[str | None] = mapped_column(Text)
    subscription_name: Mapped[str | None] = mapped_column(String(255))
    subscription_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )


class RecordingIngestion(Base):
    """One Google Meet recording we have been told about. recording_name is unique so a
    recording is only ever imported once, however many times events or polling report it."""

    __tablename__ = "recording_ingestions"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    meeting_id: Mapped[int | None] = mapped_column(ForeignKey("meetings.id", ondelete="SET NULL"))
    recording_name: Mapped[str] = mapped_column(String(255), unique=True)
    drive_file_id: Mapped[str | None] = mapped_column(String(255))
    status: Mapped[str] = mapped_column(String(16), default="pending")  # pending|done|failed
    error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )
