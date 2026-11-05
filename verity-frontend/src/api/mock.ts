// Fake backend so the frontend can be built before the real one exists.
// Turn on with VITE_USE_MOCK=true. Any login works, except the password "wrong".
import type { Api } from './types';
import { ApiError } from './types';
import { saveBlob } from '../lib/format';
import type {
  AuthResponse, MeetingDetail, MeetingStatus, ProgressEvent, TranscriptSegment,
} from '../types';

const delay = (ms = 400) => new Promise((r) => setTimeout(r, ms));

const transcript: TranscriptSegment[] = [
  { segment_id: 's1', speaker: 'Speaker 1', start: 2, end: 14, text: 'Welcome everyone. Today we need to decide on the launch date for the new dashboard.' },
  { segment_id: 's2', speaker: 'Speaker 2', start: 15, end: 31, text: 'Engineering thinks we can ship by the end of March if QA finishes the regression suite.' },
  { segment_id: 's3', speaker: 'Speaker 1', start: 32, end: 45, text: 'Okay, let us agree on March 28 for the launch. Sara, can you own the QA plan?' },
  { segment_id: 's4', speaker: 'Speaker 3', start: 46, end: 58, text: 'Yes, I will send the QA plan by next Friday.' },
  { segment_id: 's5', speaker: 'Speaker 2', start: 59, end: 80, text: 'We still have an open question about whether the mobile layout needs to be ready for launch.' },
  { segment_id: 's6', speaker: 'Speaker 1', start: 81, end: 95, text: 'Let us postpone that decision until we see the usability results.' },
];

const completeData = {
  media_url: null as string | null, // the real backend will return a URL for the player
  minutes: {
    executive_summary:
      'The team agreed to launch the new dashboard on March 28, pending QA sign-off. The mobile layout decision was postponed.',
    discussion_points: [
      { topic: 'Launch date', summary: 'Engineering estimated end of March; the group settled on March 28.' },
      { topic: 'Mobile layout', summary: 'Unclear whether it is required for launch; to be revisited after usability testing.' },
    ],
    decisions: ['Launch the dashboard on March 28.', 'Hire two more testers for the launch.'],
    open_questions: ['Does the mobile layout need to be ready for launch?'],
  },
  action_items: [
    { item_id: 'a1', owner: 'Sara', task: 'Send the QA plan', deadline: 'Next Friday', priority: 'HIGH' as const, timestamp_ref: 46 },
    { item_id: 'a2', owner: null, task: 'Review usability results', deadline: null, priority: null, timestamp_ref: 81 },
  ],
  claims: [
    { result_id: 'c1', statement_text: 'The team agreed to launch on March 28.', classification: 'SUPPORTED' as const, ragas_score: 0.94, nli_label: 'ENTAILMENT' as const, evidence: [{ segment_id: 's3', similarity_score: 0.91 }] },
    { result_id: 'c2', statement_text: 'Sara will deliver the QA plan by next Friday.', classification: 'SUPPORTED' as const, ragas_score: 0.9, nli_label: 'ENTAILMENT' as const, evidence: [{ segment_id: 's3', similarity_score: 0.8 }, { segment_id: 's4', similarity_score: 0.88 }] },
    { result_id: 'c3', statement_text: 'The mobile layout is required for launch.', classification: 'PARTIALLY_SUPPORTED' as const, ragas_score: 0.52, nli_label: 'NEUTRAL' as const, evidence: [{ segment_id: 's5', similarity_score: 0.7 }] },
    { result_id: 'c4', statement_text: 'The team decided to hire two more testers.', classification: 'UNSUPPORTED' as const, ragas_score: 0.08, nli_label: 'CONTRADICTION' as const, evidence: [] },
  ],
  transcript,
};

const emptyData = { media_url: null, minutes: null, action_items: [], claims: [], transcript: [] };

const store = new Map<string, MeetingDetail>();
const listeners = new Map<string, Set<(e: ProgressEvent) => void>>();

function seed(id: string, title: string, status: MeetingStatus, extra: Partial<MeetingDetail> = {}) {
  store.set(id, {
    meeting_id: id,
    title,
    meeting_date: new Date().toISOString(),
    source: 'UPLOAD',
    status,
    ...(status === 'COMPLETE' ? completeData : emptyData),
    ...extra,
  });
}

const PIPELINE: MeetingStatus[] = ['PENDING', 'TRANSCRIBING', 'GENERATING', 'VERIFYING', 'COMPLETE'];

function emit(id: string, e: ProgressEvent) {
  listeners.get(id)?.forEach((fn) => fn(e));
}

function runPipeline(id: string, from: MeetingStatus = 'PENDING') {
  let i = PIPELINE.indexOf(from);
  const timer = setInterval(() => {
    i += 1;
    const m = store.get(id);
    if (!m || i >= PIPELINE.length) return clearInterval(timer);
    const status = PIPELINE[i];
    store.set(id, status === 'COMPLETE'
      ? { ...m, ...completeData, status, results_ready_notice: true }
      : { ...m, status });
    emit(id, { status, segments_transcribed: status === 'TRANSCRIBING' ? 1 : undefined, segments_total: 2 });
    if (status === 'COMPLETE') clearInterval(timer);
  }, 3500);
}

seed('m1', 'Product launch planning', 'COMPLETE', { results_ready_notice: true });
seed('m2', 'Weekly sync (processing)', 'TRANSCRIBING');
seed('m3', 'Broken recording', 'FAILED', { failure_reason: 'The audio file could not be decoded.' });
runPipeline('m2', 'TRANSCRIBING');

let nextId = 4;

export const mockApi: Api = {
  async register(name, email) {
    await delay();
    return { token: 'mock-token', user: { user_id: 'u1', name, email } } satisfies AuthResponse;
  },
  async login(email, password) {
    await delay();
    if (password === 'wrong') throw new ApiError(401, 'Invalid email or password.');
    return { token: 'mock-token', user: { user_id: 'u1', name: email.split('@')[0], email } };
  },
  async logout() {
    await delay(100);
  },
  async listMeetings() {
    await delay();
    return [...store.values()]
      .map(({ media_url, minutes, action_items, claims, transcript: _t, ...summary }) => summary)
      .reverse();
  },
  async getMeeting(id) {
    await delay();
    const m = store.get(id);
    if (!m) throw new ApiError(404, 'Meeting not found');
    return m;
  },
  async uploadSegment(_file, meta, onProgress) {
    let id = meta.meetingId;
    if (!id) {
      id = `m${nextId++}`;
      seed(id, meta.title, 'PENDING');
    }
    for (let p = 0; p <= 10; p++) {
      onProgress(p / 10);
      await delay(120);
    }
    if (meta.index === meta.total - 1) runPipeline(id);
    return { job_id: `job-${id}`, meeting_id: id };
  },
  async downloadTranscript(id) {
    const m = store.get(id);
    const text = (m?.transcript ?? []).map((s) => `[${s.start}s] ${s.speaker}: ${s.text}`).join('\n');
    saveBlob(new Blob([text], { type: 'text/plain' }), `transcript-${id}.txt`);
  },
  async downloadPdf() {
    throw new ApiError(501, 'PDF export needs the real backend.');
  },
  subscribeProgress(id, onEvent, onConnection) {
    if (!listeners.has(id)) listeners.set(id, new Set());
    listeners.get(id)!.add(onEvent);
    onConnection(true);
    return () => listeners.get(id)?.delete(onEvent);
  },
};
