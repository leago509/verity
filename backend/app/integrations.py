"""Google Meet integration endpoints.

Flow:
  1. GET  /integrations/google-meet/connect   -> returns the Google consent URL
  2. Google redirects the browser to /callback -> we store an encrypted refresh token
  3. New recordings arrive by Pub/Sub push (/events) and/or by polling (tasks.py)
  4. Each recording is downloaded from Drive and fed into the normal pipeline
"""

import base64
import json
import logging
import os
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse, Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from . import google_api
from .auth import get_current_user
from .crypto import decrypt, encrypt
from .db import get_db
from .models import GoogleConnection, User
from .security import ALGORITHM, SECRET_KEY
from .tasks import handle_recording_event, reconcile_google_meet, renew_google_subscriptions

log = logging.getLogger(__name__)

FRONTEND_URL = os.environ.get("FRONTEND_URL", "http://localhost:5173")
# Pub/Sub push authentication (set these in production; see .env.example)
PUBSUB_VERIFY = os.environ.get("PUBSUB_VERIFY", "true").lower() != "false"
PUBSUB_AUDIENCE = os.environ.get("PUBSUB_AUDIENCE", "")
PUBSUB_PUSH_SA = os.environ.get("PUBSUB_PUSH_SERVICE_ACCOUNT", "")

router = APIRouter(prefix="/integrations/google-meet", tags=["google-meet"])


class StatusOut(BaseModel):
    configured: bool  # server has Google credentials
    connected: bool
    google_email: str | None = None
    status: str | None = None  # active | revoked
    last_error: str | None = None
    push_enabled: bool = False  # Pub/Sub topic configured


def _state_token(user_id: int) -> str:
    exp = datetime.now(timezone.utc) + timedelta(minutes=10)
    return jwt.encode({"sub": str(user_id), "purpose": "gmeet", "exp": exp}, SECRET_KEY, algorithm=ALGORITHM)


def _user_from_state(state: str) -> int:
    try:
        payload = jwt.decode(state, SECRET_KEY, algorithms=[ALGORITHM])
        if payload.get("purpose") != "gmeet":
            raise ValueError
        return int(payload["sub"])
    except (jwt.PyJWTError, ValueError, KeyError):
        raise HTTPException(status_code=400, detail="Invalid or expired state")


@router.get("/status", response_model=StatusOut)
def status(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    conn = db.scalar(select(GoogleConnection).where(GoogleConnection.user_id == user.id))
    return StatusOut(
        configured=google_api.configured(),
        connected=conn is not None and conn.status == "active",
        google_email=conn.google_email if conn else None,
        status=conn.status if conn else None,
        last_error=conn.last_error if conn else None,
        push_enabled=bool(google_api.PUBSUB_TOPIC),
    )


@router.get("/connect")
def connect(user: User = Depends(get_current_user)):
    if not google_api.configured():
        raise HTTPException(status_code=503, detail="Google integration is not configured on the server")
    return {"url": google_api.build_auth_url(_state_token(user.id))}


@router.get("/callback")
def callback(
    state: str,
    code: str | None = None,
    error: str | None = None,
    db: Session = Depends(get_db),
):
    """Google sends the browser here. No Authorization header, so `state` identifies the user."""
    user_id = _user_from_state(state)
    if error or not code:
        return RedirectResponse(f"{FRONTEND_URL}/?google=denied")

    tokens = google_api.exchange_code(code)
    refresh = tokens.get("refresh_token")
    if not refresh:
        return RedirectResponse(f"{FRONTEND_URL}/?google=no_refresh_token")
    email = google_api.userinfo(tokens["access_token"]).get("email", "")

    conn = db.scalar(select(GoogleConnection).where(GoogleConnection.user_id == user_id))
    if conn is None:
        conn = GoogleConnection(user_id=user_id, google_email=email, refresh_token_enc=encrypt(refresh))
        db.add(conn)
    else:
        conn.google_email = email
        conn.refresh_token_enc = encrypt(refresh)
        conn.status = "active"
        conn.last_error = None
    db.commit()

    # Set up push notifications (if a topic is configured) and pick up recent recordings now.
    renew_google_subscriptions.delay()
    reconcile_google_meet.delay(user_id)
    return RedirectResponse(f"{FRONTEND_URL}/?google=connected")


@router.post("/sync", status_code=202)
def sync_now(user: User = Depends(get_current_user)):
    """'Check for new recordings now' button. Handy for demos."""
    reconcile_google_meet.delay(user.id)
    return {"queued": True}


@router.delete("", status_code=204)
def disconnect(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    conn = db.scalar(select(GoogleConnection).where(GoogleConnection.user_id == user.id))
    if conn is not None:
        try:
            google_api.revoke(decrypt(conn.refresh_token_enc))
        finally:
            db.delete(conn)
            db.commit()
    return Response(status_code=204)


def _verify_pubsub(request: Request) -> None:
    """Pub/Sub push signs each request with a Google-issued ID token."""
    if not PUBSUB_VERIFY:
        return  # local development only
    header = request.headers.get("Authorization", "")
    if not header.startswith("Bearer ") or not PUBSUB_AUDIENCE:
        raise HTTPException(status_code=401, detail="Unauthorized")
    from google.auth.transport import requests as g_requests
    from google.oauth2 import id_token

    try:
        claims = id_token.verify_oauth2_token(header[7:], g_requests.Request(), audience=PUBSUB_AUDIENCE)
    except ValueError:
        raise HTTPException(status_code=401, detail="Unauthorized")
    if PUBSUB_PUSH_SA and (claims.get("email") != PUBSUB_PUSH_SA or not claims.get("email_verified")):
        raise HTTPException(status_code=401, detail="Unauthorized")


@router.post("/events", status_code=204)
async def pubsub_events(request: Request):
    """Pub/Sub push endpoint for 'recording file generated' events."""
    _verify_pubsub(request)
    try:
        message = (await request.json())["message"]
        attrs = message.get("attributes", {})
        data = json.loads(base64.b64decode(message.get("data", "")) or b"{}")
    except Exception:
        return Response(status_code=204)  # malformed: ack it so Pub/Sub doesn't redeliver forever

    event_type = attrs.get("ce-type", "")
    if event_type.endswith("recording.v2.fileGenerated"):
        name = (data.get("recording") or {}).get("name")
        if name:
            handle_recording_event.delay(name)
        else:
            log.warning("fileGenerated event without recording name: %s", data)
    return Response(status_code=204)
