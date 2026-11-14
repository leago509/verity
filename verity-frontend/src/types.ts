// Types mirror the report: state machine (Fig 3.8) and entities (Tables 3.8-3.11).

export type MeetingStatus =
  | 'WAITING_RECORDING'
  | 'DOWNLOADING'
  | 'PENDING'
  | 'TRANSCRIBING'
  | 'GENERATING'
  | 'VERIFYING'
  | 'COMPLETE'
  | 'FAILED';

export type Classification = 'SUPPORTED' | 'PARTIALLY_SUPPORTED' | 'UNSUPPORTED';
export type Priority = 'HIGH' | 'MEDIUM' | 'LOW';

export interface User {
  user_id: string;
  name: string;
  email: string;
}

export interface AuthResponse {
  token: string;
  user: User;
}

export interface MeetingSummary {
  meeting_id: string;
  title: string;
  meeting_date: string; // ISO string
  source: 'UPLOAD' | 'GOOGLE_MEET';
  status: MeetingStatus;
  failure_reason?: string | null;
  results_ready_notice?: boolean;
}

export interface TranscriptSegment {
  segment_id: string;
  speaker: string; // "Speaker 1" when the name is unknown
  start: number; // seconds from recording start
  end: number;
  text: string;
}

export interface Minutes {
  executive_summary: string;
  discussion_points: { topic: string; summary: string }[];
  decisions: string[];
  open_questions: string[];
}

export interface ActionItem {
  item_id: string;
  owner: string | null; // never infer a value the meeting did not state
  task: string;
  deadline: string | null;
  priority: Priority | null;
  timestamp_ref: number; // seconds
}

export interface Evidence {
  segment_id: string;
  similarity_score: number;
}

export interface ClaimResult {
  result_id: string;
  statement_text: string;
  classification: Classification;
  ragas_score: number; // 0..1
  nli_label: 'ENTAILMENT' | 'NEUTRAL' | 'CONTRADICTION';
  evidence: Evidence[]; // may be empty -> UI says "evidence unavailable"
}

export interface MeetingDetail extends MeetingSummary {
  media_url: string | null;
  minutes: Minutes | null;
  action_items: ActionItem[];
  claims: ClaimResult[];
  transcript: TranscriptSegment[];
}

export interface ProgressEvent {
  status: MeetingStatus;
  segments_transcribed?: number;
  segments_total?: number;
  message?: string;
}

export interface UploadMeta {
  title: string;
  meetingId?: string;
  index: number; // order of this segment, starting at 0
  total: number;
}

export interface UploadResult {
  job_id: string;
  meeting_id: string;
}

export interface GoogleMeetStatus {
  configured: boolean; // server has Google credentials
  connected: boolean;
  google_email: string | null;
  status: string | null; // "active" | "revoked"
  last_error: string | null;
  push_enabled: boolean;
}
