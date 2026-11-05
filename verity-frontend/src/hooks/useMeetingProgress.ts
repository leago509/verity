import { useEffect, useState } from 'react';
import { api } from '../api';
import type { ProgressEvent } from '../types';

/** Live progress over WebSocket. `onDone` fires on COMPLETE/FAILED so the page can refetch. */
export function useMeetingProgress(meetingId: string | undefined, active: boolean, onDone: () => void) {
  const [progress, setProgress] = useState<ProgressEvent | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!meetingId || !active) return;
    const unsubscribe = api.subscribeProgress(
      meetingId,
      (e) => {
        setProgress(e);
        if (e.status === 'COMPLETE' || e.status === 'FAILED') onDone();
      },
      setConnected,
    );
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetingId, active]);

  return { progress, connected };
}
