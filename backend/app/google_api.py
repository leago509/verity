"""Thin wrapper around the Google REST APIs Verity needs (OAuth, Meet, Drive, Workspace Events).

Plain `requests` calls, so it is easy to read and to mock in tests.
"""

import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlencode

import requests

from .crypto import decrypt

CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID", "")
CLIENT_SECRET = os.environ.get("GOOGLE_CLIENT_SECRET", "")
REDIRECT_URI = os.environ.get(
    "GOOGLE_REDIRECT_URI", "http://localhost:8000/integrations/google-meet/callback"
)
# Optional. Without a Pub/Sub topic, recordings are found by polling only (see tasks.py).
PUBSUB_TOPIC = os.environ.get("GOOGLE_PUBSUB_TOPIC", "")  # projects/PROJECT/topics/TOPIC

SCOPES = [
    "openid",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/meetings.space.readonly",  # list conferences/recordings
    "https://www.googleapis.com/auth/drive.meet.readonly",  # download Meet-made files only
]

AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
REVOKE_URL = "https://oauth2.googleapis.com/revoke"
USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo"
MEET = "https://meet.googleapis.com/v2"
DRIVE = "https://www.googleapis.com/drive/v3"
EVENTS = "https://workspaceevents.googleapis.com/v1"
TIMEOUT = 30


class GoogleAuthError(Exception):
    """The refresh token no longer works (revoked, expired, app removed)."""


def configured() -> bool:
    return bool(CLIENT_ID and CLIENT_SECRET)


def build_auth_url(state: str) -> str:
    params = {
        "client_id": CLIENT_ID,
        "redirect_uri": REDIRECT_URI,
        "response_type": "code",
        "scope": " ".join(SCOPES),
        "access_type": "offline",  # gives us a refresh token
        "prompt": "consent",  # always return the refresh token, even on re-connect
        "include_granted_scopes": "true",
        "state": state,
    }
    return f"{AUTH_URL}?{urlencode(params)}"


def exchange_code(code: str) -> dict:
    res = requests.post(
        TOKEN_URL,
        data={
            "code": code,
            "client_id": CLIENT_ID,
            "client_secret": CLIENT_SECRET,
            "redirect_uri": REDIRECT_URI,
            "grant_type": "authorization_code",
        },
        timeout=TIMEOUT,
    )
    res.raise_for_status()
    return res.json()


def userinfo(access_token: str) -> dict:
    res = requests.get(USERINFO_URL, headers=_auth(access_token), timeout=TIMEOUT)
    res.raise_for_status()
    return res.json()


def revoke(token: str) -> None:
    try:
        requests.post(REVOKE_URL, data={"token": token}, timeout=TIMEOUT)
    except requests.RequestException:
        pass  # best effort


def access_token(conn) -> str:
    """Trades the stored refresh token for a short-lived access token."""
    res = requests.post(
        TOKEN_URL,
        data={
            "client_id": CLIENT_ID,
            "client_secret": CLIENT_SECRET,
            "refresh_token": decrypt(conn.refresh_token_enc),
            "grant_type": "refresh_token",
        },
        timeout=TIMEOUT,
    )
    if res.status_code in (400, 401):  # invalid_grant etc.
        raise GoogleAuthError(res.text[:300])
    res.raise_for_status()
    return res.json()["access_token"]


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


# ---------- Meet REST API ----------

def get_recording(token: str, name: str) -> dict | None:
    """name = conferenceRecords/{id}/recordings/{id}. None if this account can't see it."""
    res = requests.get(f"{MEET}/{name}", headers=_auth(token), timeout=TIMEOUT)
    if res.status_code in (403, 404):
        return None
    res.raise_for_status()
    return res.json()


def list_conferences(token: str, since: datetime) -> list[dict]:
    """Conference records started after `since` that this account can see."""
    out, page = [], None
    while True:
        params = {
            "filter": f'start_time>="{since.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")}"',
            "pageSize": 100,
        }
        if page:
            params["pageToken"] = page
        res = requests.get(
            f"{MEET}/conferenceRecords", headers=_auth(token), params=params, timeout=TIMEOUT
        )
        res.raise_for_status()
        body = res.json()
        out += body.get("conferenceRecords", [])
        page = body.get("nextPageToken")
        if not page:
            return out


def list_recordings(token: str, conference_name: str) -> list[dict]:
    res = requests.get(
        f"{MEET}/{conference_name}/recordings", headers=_auth(token), timeout=TIMEOUT
    )
    res.raise_for_status()
    return res.json().get("recordings", [])


# ---------- Drive ----------

def download_drive_file(token: str, file_id: str, dest: Path) -> int:
    """Streams a Drive file to disk and returns the number of bytes written."""
    written = 0
    with requests.get(
        f"{DRIVE}/files/{file_id}",
        headers=_auth(token),
        params={"alt": "media"},
        stream=True,
        timeout=(TIMEOUT, 120),
    ) as res:
        res.raise_for_status()
        with open(dest, "wb") as out:
            for chunk in res.iter_content(chunk_size=1024 * 1024):
                out.write(chunk)
                written += len(chunk)
    return written


# ---------- Workspace Events (push notifications through Pub/Sub) ----------

def create_subscription(token: str, user_email: str) -> dict:
    """Subscribes to 'recording file generated' for every meeting this user owns.

    Returns {"name": ..., "expire_time": datetime | None} when Google answers straight
    away; otherwise both are None (the call is a long-running operation) and polling
    covers us until the next renewal pass.
    """
    body = {
        "targetResource": f"//cloudidentity.googleapis.com/users/{user_email}",
        "eventTypes": ["google.workspace.meet.recording.v2.fileGenerated"],
        "notificationEndpoint": {"pubsubTopic": PUBSUB_TOPIC},
    }
    res = requests.post(f"{EVENTS}/subscriptions", headers=_auth(token), json=body, timeout=TIMEOUT)
    res.raise_for_status()
    op = res.json()
    sub = op.get("response") if op.get("done") else None
    if not sub:
        return {"name": None, "expire_time": None}
    return {"name": sub.get("name"), "expire_time": _parse_time(sub.get("expireTime"))}


def renew_subscription(token: str, name: str) -> datetime | None:
    """ttl "0s" asks Google for the maximum lifetime."""
    res = requests.patch(
        f"{EVENTS}/{name}",
        headers=_auth(token),
        params={"updateMask": "ttl"},
        json={"ttl": "0s"},
        timeout=TIMEOUT,
    )
    res.raise_for_status()
    op = res.json()
    sub = op.get("response") if op.get("done") else None
    return _parse_time(sub.get("expireTime")) if sub else None


def _parse_time(value: str | None) -> datetime | None:
    if not value:
        return None
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def now() -> datetime:
    return datetime.now(timezone.utc)


def soon(hours: int = 24) -> datetime:
    return now() + timedelta(hours=hours)
