import type {
  AuthResponse, MeetingDetail, MeetingSummary, ProgressEvent, UploadMeta, UploadResult,
} from '../types';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface Api {
  register(name: string, email: string, password: string): Promise<AuthResponse>;
  login(email: string, password: string): Promise<AuthResponse>;
  logout(): Promise<void>;
  listMeetings(): Promise<MeetingSummary[]>;
  getMeeting(id: string): Promise<MeetingDetail>;
  uploadSegment(file: File, meta: UploadMeta, onProgress: (fraction: number) => void): Promise<UploadResult>;
  downloadTranscript(id: string): Promise<void>;
  downloadPdf(id: string): Promise<void>;
  /** Returns an unsubscribe function. */
  subscribeProgress(
    id: string,
    onEvent: (e: ProgressEvent) => void,
    onConnection: (connected: boolean) => void,
  ): () => void;
}
