import { useMemo, useState, type ReactNode } from 'react';
import { formatTime } from '../lib/format';
import type { TranscriptSegment } from '../types';

interface Props {
  segments: TranscriptSegment[];
  playingId: string | null; // segment under the playhead
  focusId: string | null; // segment picked from claim evidence
  onSeek: (seconds: number, segmentId: string) => void;
}

function Highlight({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  const parts: ReactNode[] = [];
  let i = 0;
  while (i < text.length) {
    const hit = lower.indexOf(q, i);
    if (hit === -1) {
      parts.push(text.slice(i));
      break;
    }
    if (hit > i) parts.push(text.slice(i, hit));
    parts.push(<mark key={hit} className="bg-yellow-200">{text.slice(hit, hit + q.length)}</mark>);
    i = hit + q.length;
  }
  return <>{parts}</>;
}

export default function TranscriptViewer({ segments, playingId, focusId, onSeek }: Props) {
  const [query, setQuery] = useState('');
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? segments.filter((s) => s.text.toLowerCase().includes(q)).length : segments.length;
  }, [segments, query]);
  const q = query.trim();

  return (
    <div>
      <div className="mb-3 flex items-center gap-3">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search transcript…"
          className="w-full rounded-md border px-3 py-2 text-sm"
          aria-label="Search transcript"
        />
        {q && <span className="whitespace-nowrap text-sm text-slate-500">{matches} match{matches === 1 ? '' : 'es'}</span>}
      </div>
      <ul className="max-h-[28rem] space-y-1 overflow-y-auto">
        {segments.map((s) => {
          const isMatch = q && s.text.toLowerCase().includes(q.toLowerCase());
          const active = s.segment_id === playingId || s.segment_id === focusId;
          return (
            <li
              key={s.segment_id}
              id={`seg-${s.segment_id}`}
              className={`flex gap-3 rounded-md p-2 text-sm ${active ? 'bg-blue-50 ring-1 ring-blue-300' : ''} ${q && !isMatch ? 'opacity-40' : ''}`}
            >
              <button
                onClick={() => onSeek(s.start, s.segment_id)}
                className="w-14 shrink-0 text-left font-mono text-blue-700 hover:underline"
                title="Jump to this moment"
              >
                {formatTime(s.start)}
              </button>
              <div>
                <div className="text-xs font-semibold text-slate-500">{s.speaker}</div>
                <div><Highlight text={s.text} query={q} /></div>
              </div>
            </li>
          );
        })}
        {segments.length === 0 && <li className="text-sm text-slate-500">No transcript available.</li>}
      </ul>
    </div>
  );
}
