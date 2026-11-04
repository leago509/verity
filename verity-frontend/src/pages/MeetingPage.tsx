import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import ClaimList from '../components/ClaimList';
import { IN_PROGRESS, StatusBadge } from '../components/StatusBadge';
import TranscriptViewer from '../components/TranscriptViewer';
import { useMeetingProgress } from '../hooks/useMeetingProgress';
import { formatDate, formatTime } from '../lib/format';
import type { MeetingDetail } from '../types';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border bg-white p-5">
      <h2 className="mb-3 text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}

export default function MeetingPage() {
  const { id } = useParams<{ id: string }>();
  const [meeting, setMeeting] = useState<MeetingDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const mediaRef = useRef<HTMLAudioElement>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      setMeeting(await api.getMeeting(id));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load this meeting.');
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const inProgress = !!meeting && IN_PROGRESS.includes(meeting.status);
  const { progress, connected } = useMeetingProgress(id, inProgress, load);
  const liveStatus = progress?.status ?? meeting?.status;

  // FR-07: clicking a timestamp moves the player and highlights the segment.
  function seek(seconds: number, segmentId: string) {
    setFocusId(segmentId);
    document.getElementById(`seg-${segmentId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const el = mediaRef.current;
    if (el && meeting?.media_url) {
      el.currentTime = seconds;
      el.play().catch(() => undefined);
    }
  }

  function onTimeUpdate() {
    const t = mediaRef.current?.currentTime ?? 0;
    const seg = meeting?.transcript.find((s) => t >= s.start && t < s.end);
    setPlayingId(seg?.segment_id ?? null);
  }

  async function run(action: () => Promise<void>) {
    setNotice(null);
    try {
      await action();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Download failed.');
    }
  }

  if (error) return <p role="alert" className="rounded-md bg-red-50 p-3 text-red-700">{error} <Link to="/" className="underline">Back</Link></p>;
  if (!meeting) return <p className="text-slate-500">Loading…</p>;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link to="/" className="text-sm text-blue-700 hover:underline">← All meetings</Link>
          <h1 className="text-2xl font-bold">{meeting.title}</h1>
          <p className="text-sm text-slate-500">{formatDate(meeting.meeting_date)}</p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={liveStatus ?? meeting.status} />
          {meeting.status === 'COMPLETE' && (
            <>
              <button onClick={() => run(() => api.downloadTranscript(meeting.meeting_id))} className="rounded-md border px-3 py-1.5 text-sm hover:bg-slate-100">Transcript</button>
              <button onClick={() => run(() => api.downloadPdf(meeting.meeting_id))} className="rounded-md bg-slate-900 px-3 py-1.5 text-sm text-white">Export PDF</button>
            </>
          )}
        </div>
      </div>
      {notice && <p role="alert" className="rounded-md bg-amber-50 p-3 text-sm text-amber-800">{notice}</p>}

      {inProgress && (
        <Section title="Processing your meeting">
          <p className="text-sm">Current step: <strong>{liveStatus}</strong></p>
          {progress?.segments_total != null && progress.segments_transcribed != null && (
            <p className="text-sm text-slate-600">Segments transcribed: {progress.segments_transcribed} / {progress.segments_total}</p>
          )}
          <p className="mt-2 text-xs text-slate-500">
            {connected ? 'Live updates connected.' : 'Reconnecting…'} You can close this page; results will be waiting on your dashboard.
          </p>
        </Section>
      )}

      {meeting.status === 'FAILED' && (
        <Section title="Processing failed">
          <p className="text-sm text-red-700">{meeting.failure_reason ?? 'An unknown error occurred.'}</p>
        </Section>
      )}

      {meeting.status === 'COMPLETE' && meeting.minutes && (
        <>
          <Section title="Executive summary"><p className="text-sm leading-relaxed">{meeting.minutes.executive_summary}</p></Section>

          <Section title="Discussion">
            <div className="space-y-3">
              {meeting.minutes.discussion_points.map((d) => (
                <div key={d.topic}><h3 className="text-sm font-semibold">{d.topic}</h3><p className="text-sm text-slate-700">{d.summary}</p></div>
              ))}
            </div>
          </Section>

          <div className="grid gap-5 md:grid-cols-2">
            <Section title="Decisions">
              <ul className="list-disc space-y-1 pl-5 text-sm">{meeting.minutes.decisions.map((d) => <li key={d}>{d}</li>)}</ul>
            </Section>
            <Section title="Open questions">
              <ul className="list-disc space-y-1 pl-5 text-sm">{meeting.minutes.open_questions.map((q) => <li key={q}>{q}</li>)}</ul>
            </Section>
          </div>

          <Section title="Action items">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs uppercase text-slate-500">
                  <tr><th className="py-2 pr-3">Owner</th><th className="pr-3">Task</th><th className="pr-3">Deadline</th><th className="pr-3">Priority</th><th>Time</th></tr>
                </thead>
                <tbody>
                  {meeting.action_items.map((a) => (
                    <tr key={a.item_id} className="border-t">
                      <td className="py-2 pr-3">{a.owner ?? <span className="text-slate-400">Not stated</span>}</td>
                      <td className="pr-3">{a.task}</td>
                      <td className="pr-3">{a.deadline ?? <span className="text-slate-400">Not stated</span>}</td>
                      <td className="pr-3">{a.priority ?? <span className="text-slate-400">Not stated</span>}</td>
                      <td>
                        <button className="font-mono text-blue-700 hover:underline" onClick={() => {
                          const seg = meeting.transcript.find((s) => a.timestamp_ref >= s.start && a.timestamp_ref <= s.end);
                          seek(a.timestamp_ref, seg?.segment_id ?? '');
                        }}>{formatTime(a.timestamp_ref)}</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          <Section title="Claim verification">
            <p className="mb-3 text-sm text-slate-600">Each statement in the minutes is checked against the transcript.</p>
            <ClaimList claims={meeting.claims} transcript={meeting.transcript} onEvidenceClick={seek} />
          </Section>

          <Section title="Transcript">
            {meeting.media_url ? (
              <audio ref={mediaRef} src={meeting.media_url} controls onTimeUpdate={onTimeUpdate} className="mb-3 w-full" />
            ) : (
              <p className="mb-3 rounded-md bg-slate-50 p-2 text-xs text-slate-500">No playable media for this meeting yet, timestamps still highlight the transcript.</p>
            )}
            <TranscriptViewer segments={meeting.transcript} playingId={playingId} focusId={focusId} onSeek={seek} />
          </Section>
        </>
      )}
    </div>
  );
}
