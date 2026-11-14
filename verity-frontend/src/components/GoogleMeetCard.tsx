import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api';
import type { GoogleMeetStatus } from '../types';

const NOTICES: Record<string, string> = {
  connected: 'Google Meet connected. New recordings will appear here automatically.',
  denied: 'Google Meet was not connected (access was declined).',
  no_refresh_token:
    'Google did not return offline access. Remove Verity from your Google account permissions and try again.',
};

/** Connect / disconnect Google Meet and trigger a manual check for new recordings. */
export default function GoogleMeetCard() {
  const [status, setStatus] = useState<GoogleMeetStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [params, setParams] = useSearchParams();

  const load = useCallback(async () => {
    try {
      setStatus(await api.getGoogleMeetStatus());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load Google Meet status.');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Google sends the browser back to /?google=connected|denied|no_refresh_token
  useEffect(() => {
    const result = params.get('google');
    if (!result) return;
    setMessage(NOTICES[result] ?? null);
    params.delete('google');
    setParams(params, { replace: true });
  }, [params, setParams]);

  const run = async (fn: () => Promise<void>, done?: string) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      if (done) setMessage(done);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  const connect = () =>
    run(async () => {
      window.location.href = await api.getGoogleMeetConnectUrl();
    });

  if (!status && !error) return null;

  return (
    <section className="mb-6 rounded-xl border bg-white p-4" aria-label="Google Meet connection">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold">Google Meet</h2>
          {status?.connected ? (
            <p className="text-sm text-slate-600">
              Connected as {status.google_email}. Recordings of meetings you organise are imported
              automatically.
            </p>
          ) : status?.status === 'revoked' ? (
            <p className="text-sm text-amber-700">Access expired or was revoked. Please reconnect.</p>
          ) : (
            <p className="text-sm text-slate-600">
              Connect your Google account to import meeting recordings automatically.
            </p>
          )}
        </div>
        <div className="flex gap-2">
          {status?.connected && (
            <>
              <button
                disabled={busy}
                onClick={() => run(() => api.syncGoogleMeet(), 'Checking for new recordings…')}
                className="rounded-md border px-3 py-1.5 text-sm disabled:opacity-50"
              >
                Check for new recordings
              </button>
              <button
                disabled={busy}
                onClick={() => run(() => api.disconnectGoogleMeet(), 'Google Meet disconnected.')}
                className="rounded-md border px-3 py-1.5 text-sm text-red-700 disabled:opacity-50"
              >
                Disconnect
              </button>
            </>
          )}
          {!status?.connected && status?.configured !== false && (
            <button
              disabled={busy}
              onClick={connect}
              className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            >
              {status?.status === 'revoked' ? 'Reconnect Google Meet' : 'Connect Google Meet'}
            </button>
          )}
        </div>
      </div>
      {status?.configured === false && (
        <p className="mt-2 text-sm text-slate-500">
          Google Meet is not set up on this server yet (missing Google credentials).
        </p>
      )}
      {message && <p role="status" className="mt-2 text-sm text-green-700">{message}</p>}
      {(error || status?.last_error) && (
        <p role="alert" className="mt-2 text-sm text-red-700">{error ?? status?.last_error}</p>
      )}
    </section>
  );
}
