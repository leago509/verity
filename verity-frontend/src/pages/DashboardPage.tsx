import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import GoogleMeetCard from '../components/GoogleMeetCard';
import { IN_PROGRESS, StatusBadge } from '../components/StatusBadge';
import { formatDate } from '../lib/format';
import type { MeetingSummary } from '../types';

export default function DashboardPage() {
  const [meetings, setMeetings] = useState<MeetingSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setMeetings(await api.listMeetings());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load meetings.');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Refresh every 8 s while anything is still processing.
  useEffect(() => {
    if (!meetings?.some((m) => IN_PROGRESS.includes(m.status))) return;
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [meetings, load]);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Your meetings</h1>
        <Link to="/upload" className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white">Upload recording</Link>
      </div>
      <GoogleMeetCard />
      {error && <p role="alert" className="mb-3 rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {meetings === null && !error && <p className="text-slate-500">Loading…</p>}
      {meetings && meetings.length === 0 && (
        <div className="rounded-xl border border-dashed bg-white p-10 text-center text-slate-500">
          No meetings yet. <Link to="/upload" className="text-blue-700 underline">Upload your first recording.</Link>
        </div>
      )}
      {meetings && meetings.length > 0 && (
        <div className="overflow-x-auto rounded-xl border bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-slate-50 text-xs uppercase text-slate-500">
              <tr><th className="p-3">Title</th><th className="p-3">Date</th><th className="p-3">Source</th><th className="p-3">Status</th></tr>
            </thead>
            <tbody>
              {meetings.map((m) => (
                <tr key={m.meeting_id} className="border-b last:border-0 hover:bg-slate-50">
                  <td className="p-3">
                    <Link to={`/meetings/${m.meeting_id}`} className="font-medium text-blue-700 hover:underline">{m.title}</Link>
                    {m.results_ready_notice && m.status === 'COMPLETE' && (
                      <span className="ml-2 rounded bg-green-50 px-1.5 py-0.5 text-xs text-green-700">Results ready</span>
                    )}
                  </td>
                  <td className="p-3 text-slate-600">{formatDate(m.meeting_date)}</td>
                  <td className="p-3 text-slate-600">{m.source === 'UPLOAD' ? 'Manual upload' : 'Google Meet'}</td>
                  <td className="p-3"><StatusBadge status={m.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
