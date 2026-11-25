import { useEffect, useRef, useState } from 'react';
import type { CitedSummary } from '../../shared';
import type { Api } from '../api';
export function useSummary(api: Api, articleId?: string) {
  const [summaryId, setSummaryId] = useState<string | null>(null),
    [summary, setSummary] = useState<CitedSummary | null>(null);
  const [summaryBusy, setSummaryBusy] = useState(false),
    [summaryError, setSummaryError] = useState('');
  const cache = useRef(new Map<string, CitedSummary>()),
    sequence = useRef(0),
    dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    sequence.current++;
    setSummaryId(null);
    setSummary(null);
  }, [articleId]);
  useEffect(() => {
    if (!summaryId) return;
    const previous = document.activeElement as HTMLElement;
    dialog.current?.showModal();
    return () => {
      dialog.current?.close();
      previous?.focus();
    };
  }, [summaryId]);
  const openSummary = async (id: string) => {
    if (!articleId) return;
    const ticket = ++sequence.current;
    setSummaryId(id);
    setSummary(null);
    setSummaryError('');
    const key = `${articleId}:${id}`;
    const saved = cache.current.get(key);
    if (saved) {
      setSummary(saved);
      setSummaryBusy(false);
      return;
    }
    setSummaryBusy(true);
    try {
      const r = await api(`/api/sessions/${articleId}/summary`, {
        method: 'POST',
        body: JSON.stringify({ chapterId: id }),
      });
      const data = (await r.json()) as CitedSummary;
      cache.current.set(key, data);
      if (ticket === sequence.current) setSummary(data);
    } catch (e) {
      if (ticket === sequence.current) setSummaryError((e as Error).message);
    } finally {
      if (ticket === sequence.current) setSummaryBusy(false);
    }
  };
  const closeSummary = () => {
    sequence.current++;
    setSummaryId(null);
  };
  return { summaryId, summary, summaryBusy, summaryError, dialog, openSummary, closeSummary };
}
