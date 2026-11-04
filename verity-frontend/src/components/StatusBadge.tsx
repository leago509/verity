import type { MeetingStatus } from '../types';

const STYLES: Record<MeetingStatus, { label: string; cls: string }> = {
  WAITING_RECORDING: { label: 'Waiting for recording', cls: 'bg-slate-100 text-slate-700' },
  DOWNLOADING: { label: 'Downloading', cls: 'bg-blue-100 text-blue-800' },
  PENDING: { label: 'Queued', cls: 'bg-slate-100 text-slate-700' },
  TRANSCRIBING: { label: 'Transcribing', cls: 'bg-amber-100 text-amber-800' },
  GENERATING: { label: 'Generating minutes', cls: 'bg-amber-100 text-amber-800' },
  VERIFYING: { label: 'Verifying claims', cls: 'bg-purple-100 text-purple-800' },
  COMPLETE: { label: 'Complete', cls: 'bg-green-100 text-green-800' },
  FAILED: { label: 'Failed', cls: 'bg-red-100 text-red-800' },
};

export const IN_PROGRESS: MeetingStatus[] = [
  'WAITING_RECORDING', 'DOWNLOADING', 'PENDING', 'TRANSCRIBING', 'GENERATING', 'VERIFYING',
];

export function StatusBadge({ status }: { status: MeetingStatus }) {
  const { label, cls } = STYLES[status];
  return <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${cls}`}>{label}</span>;
}
