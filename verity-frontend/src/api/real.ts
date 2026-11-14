import type { Api } from './types';
import { ApiError } from './types';
import { notifyUnauthorized, session } from './session';
import { saveBlob } from '../lib/format';
import type { AuthResponse, GoogleMeetStatus, MeetingDetail, MeetingSummary, ProgressEvent, UploadResult } from '../types';

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:8000';
const WS_BASE = import.meta.env.VITE_WS_URL ?? 'ws://localhost:8000';

async function errorMessage(res: Response): Promise<string> {
  try {
    const body = await res.json();
    if (typeof body.detail === 'string') return body.detail; // FastAPI style
  } catch {
    /* ignore */
  }
  return res.statusText || `Request failed (${res.status})`;
}

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const token = session.getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const res = await fetch(`${BASE}${path}`, { ...init, headers });
  if (res.status === 401 && token) notifyUnauthorized(); // idle session expired (FR-01)
  if (!res.ok) throw new ApiError(res.status, await errorMessage(res));
  return res;
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  return (await request(path, init)).json() as Promise<T>;
}

async function download(path: string, filename: string) {
  const res = await request(path);
  saveBlob(await res.blob(), filename);
}

export const realApi: Api = {
  register: (name, email, password) =>
    json<AuthResponse>('/auth/register', { method: 'POST', body: JSON.stringify({ name, email, password }) }),

  login: (email, password) =>
    json<AuthResponse>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),

  logout: async () => {
    await request('/auth/logout', { method: 'POST' });
  },

  listMeetings: () => json<MeetingSummary[]>('/meetings'),
  getMeeting: (id) => json<MeetingDetail>(`/meetings/${id}`),

  // XMLHttpRequest because fetch cannot report upload progress.
  uploadSegment: (file, meta, onProgress) =>
    new Promise<UploadResult>((resolve, reject) => {
      const form = new FormData();
      form.append('file', file);
      form.append('title', meta.title);
      form.append('segment_index', String(meta.index));
      form.append('segment_total', String(meta.total));
      if (meta.meetingId) form.append('meeting_id', meta.meetingId);

      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${BASE}/upload`);
      const token = session.getToken();
      if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(e.loaded / e.total);
      };
      xhr.onload = () => {
        if (xhr.status === 401) notifyUnauthorized();
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(JSON.parse(xhr.responseText) as UploadResult); // HTTP 202 {job_id, meeting_id}
        } else {
          let msg = `Upload failed (${xhr.status})`;
          try {
            const b = JSON.parse(xhr.responseText);
            if (typeof b.detail === 'string') msg = b.detail;
          } catch {
            /* ignore */
          }
          reject(new ApiError(xhr.status, msg));
        }
      };
      xhr.onerror = () => reject(new ApiError(0, 'Network error during upload'));
      xhr.send(form);
    }),

  downloadTranscript: (id) => download(`/meetings/${id}/transcript/download`, `transcript-${id}.txt`),
  downloadPdf: (id) => download(`/meetings/${id}/pdf`, `verity-report-${id}.pdf`),

  getGoogleMeetStatus: () => json<GoogleMeetStatus>('/integrations/google-meet/status'),
  getGoogleMeetConnectUrl: async () =>
    (await json<{ url: string }>('/integrations/google-meet/connect')).url,
  syncGoogleMeet: async () => {
    await request('/integrations/google-meet/sync', { method: 'POST' });
  },
  disconnectGoogleMeet: async () => {
    await request('/integrations/google-meet', { method: 'DELETE' });
  },

  // WSS /ws/meetings/{id}. Auto-reconnects; the server must authenticate before subscribing.
  subscribeProgress: (id, onEvent, onConnection) => {
    let ws: WebSocket | null = null;
    let closedByUs = false;
    let retry: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      ws = new WebSocket(`${WS_BASE}/ws/meetings/${id}`);
      ws.onopen = () => {
        // Browsers cannot set headers on WebSockets, so authenticate with the first message.
        ws?.send(JSON.stringify({ type: 'auth', token: session.getToken() }));
        onConnection(true);
      };
      ws.onmessage = (m) => {
        try {
          onEvent(JSON.parse(m.data) as ProgressEvent);
        } catch {
          /* ignore malformed frames */
        }
      };
      ws.onclose = () => {
        onConnection(false);
        if (!closedByUs) retry = setTimeout(connect, 3000);
      };
      ws.onerror = () => ws?.close();
    };
    connect();

    return () => {
      closedByUs = true;
      clearTimeout(retry);
      ws?.close();
    };
  },
};
