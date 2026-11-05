# Verity API contract (frontend <-> backend)

Endpoints come from Table 3.3 of the project report. Request/response shapes marked
**(proposed)** are the frontend's assumptions: agree them with Person A and edit this file.

Auth: every protected call sends `Authorization: Bearer <token>`. A `401` means the session
expired (FR-01) and the frontend returns the user to the login page.
Errors: FastAPI style `{ "detail": "message" }`.

| Method | Path | Body / response (proposed) |
|---|---|---|
| POST | /auth/register | `{name,email,password}` -> `{token, user:{user_id,name,email}}` |
| POST | /auth/login | `{email,password}` -> `{token, user}`. 401 on bad credentials; account locks after 5 failures (UC-01) |
| POST | /auth/logout | -> 204 |
| POST | /upload | multipart: `file`, `title`, `segment_index`, `segment_total`, optional `meeting_id` -> **202** `{job_id, meeting_id}`. MP3/MP4/WAV only |
| GET | /meetings | -> `MeetingSummary[]` (only the caller's meetings) |
| GET | /meetings/{id} | -> `MeetingDetail` (see `src/types.ts`): minutes, action_items, claims (+evidence), transcript, media_url |
| GET | /meetings/{id}/transcript/download | -> text file with speaker labels + timestamps |
| GET | /meetings/{id}/pdf | -> PDF report |
| WSS | /ws/meetings/{id} | client sends `{type:"auth", token}` first; server then streams `ProgressEvent` `{status, segments_transcribed?, segments_total?, message?}` |

Meeting `status` values (state machine, Fig 3.8):
`WAITING_RECORDING, DOWNLOADING, PENDING, TRANSCRIBING, GENERATING, VERIFYING, COMPLETE, FAILED`

Claim `classification`: `SUPPORTED | PARTIALLY_SUPPORTED | UNSUPPORTED`.
If a claim has no evidence, return `evidence: []`: the UI will say "evidence unavailable" (UC-06).

Zoom endpoints (`/integrations/zoom*`) are intentionally not used yet.
