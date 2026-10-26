import { useEffect, useState } from 'react';
import type { TenderImportStatus } from '@bnect/shared';
import { api } from '../api';

const POLL_INTERVAL_MS = 4000;

export function useTenderImportStatus(onReady: () => void) {
  const [status, setStatus] = useState<TenderImportStatus | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let completedAt: string | undefined;

    async function poll() {
      try {
        const next = await api.importStatus(controller.signal);
        if (controller.signal.aborted) return;
        setStatus(next);
        if (next.stage === 'ready' && next.updatedAt !== completedAt) {
          completedAt = next.updatedAt;
          onReady();
        }
      } catch {
        // Keep the latest status while the API restarts.
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(poll, POLL_INTERVAL_MS);
      }
    }

    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [onReady]);

  return status;
}
