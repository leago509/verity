import { useRef, useState, type DragEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { validateRecording, MAX_FILE_MB } from '../lib/validation';

export default function UploadPage() {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [progress, setProgress] = useState<number[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);

  function addFiles(list: FileList | File[]) {
    const ok: File[] = [];
    const bad: string[] = [];
    Array.from(list).forEach((f) => {
      const problem = validateRecording(f);
      if (problem) bad.push(problem);
      else ok.push(f);
    });
    setFiles((prev) => [...prev, ...ok]);
    setErrors(bad);
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    addFiles(e.dataTransfer.files);
  }

  function move(i: number, dir: -1 | 1) {
    setFiles((prev) => {
      const j = i + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  async function submit() {
    if (!title.trim()) return setErrors(['Please give the meeting a title.']);
    if (files.length === 0) return setErrors(['Add at least one recording.']);
    setErrors([]);
    setUploading(true);
    setProgress(files.map(() => 0));
    try {
      let meetingId: string | undefined;
      for (let i = 0; i < files.length; i++) {
        const res = await api.uploadSegment(
          files[i],
          { title: title.trim(), meetingId, index: i, total: files.length },
          (p) => setProgress((prev) => prev.map((v, k) => (k === i ? p : v))),
        );
        meetingId = res.meeting_id; // every later segment joins the same meeting
      }
      navigate(`/meetings/${meetingId}`);
    } catch (e) {
      setErrors([e instanceof Error ? e.message : 'Upload failed.']);
      setUploading(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-4 text-2xl font-bold">Upload a recording</h1>
      <label className="mb-4 block text-sm font-medium">Meeting title
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          disabled={uploading}
          className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
          placeholder="e.g. Sprint planning"
        />
      </label>

      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => !uploading && inputRef.current?.click()}
        className={`cursor-pointer rounded-xl border-2 border-dashed bg-white p-10 text-center text-sm ${dragging ? 'border-blue-500 bg-blue-50' : 'border-slate-300'}`}
      >
        <p className="font-medium">Drag and drop recordings here, or click to browse</p>
        <p className="mt-1 text-slate-500">MP3, MP4 or WAV · up to {MAX_FILE_MB} MB each · add several parts for one meeting</p>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".mp3,.mp4,.wav,audio/mpeg,audio/wav,video/mp4"
          hidden
          onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ''; }}
        />
      </div>

      {errors.length > 0 && (
        <ul role="alert" className="mt-3 space-y-1 rounded-md bg-red-50 p-3 text-sm text-red-700">
          {errors.map((er) => <li key={er}>{er}</li>)}
        </ul>
      )}

      {files.length > 0 && (
        <ul className="mt-4 space-y-2">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} className="rounded-lg border bg-white p-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate">Part {i + 1}: {f.name} <span className="text-slate-400">({(f.size / 1024 / 1024).toFixed(1)} MB)</span></span>
                {!uploading && (
                  <span className="flex shrink-0 gap-1">
                    <button onClick={() => move(i, -1)} disabled={i === 0} className="rounded border px-2 disabled:opacity-30" aria-label="Move up">↑</button>
                    <button onClick={() => move(i, 1)} disabled={i === files.length - 1} className="rounded border px-2 disabled:opacity-30" aria-label="Move down">↓</button>
                    <button onClick={() => setFiles(files.filter((_, k) => k !== i))} className="rounded border px-2 text-red-600" aria-label="Remove">✕</button>
                  </span>
                )}
              </div>
              {uploading && (
                <div className="mt-2 h-2 overflow-hidden rounded bg-slate-200">
                  <div className="h-full bg-blue-600 transition-all" style={{ width: `${Math.round((progress[i] ?? 0) * 100)}%` }} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <button
        onClick={submit}
        disabled={uploading}
        className="mt-5 w-full rounded-md bg-slate-900 py-2.5 text-sm font-medium text-white disabled:opacity-50"
      >
        {uploading ? 'Uploading…' : 'Upload and process'}
      </button>
    </div>
  );
}
