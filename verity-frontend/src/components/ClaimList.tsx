import { useState } from 'react';
import { formatTime } from '../lib/format';
import type { ClaimResult, Classification, TranscriptSegment } from '../types';
import { ClaimBadge } from './ClaimBadge';

interface Props {
  claims: ClaimResult[];
  transcript: TranscriptSegment[];
  onEvidenceClick: (seconds: number, segmentId: string) => void;
}

const FILTERS: (Classification | 'ALL')[] = ['ALL', 'SUPPORTED', 'PARTIALLY_SUPPORTED', 'UNSUPPORTED'];

export default function ClaimList({ claims, transcript, onEvidenceClick }: Props) {
  const [filter, setFilter] = useState<Classification | 'ALL'>('ALL');
  const shown = filter === 'ALL' ? claims : claims.filter((c) => c.classification === filter);
  const bySeg = new Map(transcript.map((s) => [s.segment_id, s]));

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-full border px-3 py-1 text-xs ${filter === f ? 'bg-slate-900 text-white' : 'hover:bg-slate-100'}`}
          >
            {f === 'ALL' ? `All (${claims.length})` : `${f.replace('_', ' ').toLowerCase()} (${claims.filter((c) => c.classification === f).length})`}
          </button>
        ))}
      </div>
      <ul className="space-y-3">
        {shown.map((c) => (
          <li key={c.result_id} className="rounded-lg border bg-white p-3">
            <div className="flex items-start justify-between gap-3">
              <p className="text-sm">{c.statement_text}</p>
              <ClaimBadge classification={c.classification} />
            </div>
            <div className="mt-1 text-xs text-slate-500">
              Faithfulness {c.ragas_score.toFixed(2)} · NLI: {c.nli_label.toLowerCase()}
            </div>
            <div className="mt-2 text-sm">
              {c.evidence.length === 0 ? (
                // UC-06: never fabricate an evidence link.
                <span className="italic text-slate-500">Evidence unavailable: no supporting transcript segment was found.</span>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {c.evidence.map((ev) => {
                    const seg = bySeg.get(ev.segment_id);
                    if (!seg) return null;
                    return (
                      <button
                        key={ev.segment_id}
                        onClick={() => onEvidenceClick(seg.start, seg.segment_id)}
                        className="rounded border px-2 py-1 text-xs text-blue-700 hover:bg-blue-50"
                        title={seg.text}
                      >
                        Evidence at {formatTime(seg.start)}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </li>
        ))}
        {shown.length === 0 && <li className="text-sm text-slate-500">No claims in this category.</li>}
      </ul>
    </div>
  );
}
