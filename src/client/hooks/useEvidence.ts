import { useCallback, useEffect, useRef, useState } from 'react';
import type { Source } from '../../shared';
import type { Api } from '../api';
export function useEvidence(api: Api, articleId?: string) {
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState<Source | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const dialog = useRef<HTMLDialogElement>(null),
    epoch = useRef(0);
  useEffect(() => {
    epoch.current++;
    setOpen(false);
    setSource(null);
    setSelected(null);
    setError('');
  }, [articleId]);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement;
    dialog.current?.showModal();
    return () => {
      dialog.current?.close();
      previous?.focus();
    };
  }, [open]);
  const refresh = useCallback(async () => {
    if (!articleId) return;
    const current = epoch.current;
    setBusy(true);
    setError('');
    try {
      const response = await api(`/api/sessions/${articleId}/source`);
      const data = (await response.json()) as Source;
      if (current === epoch.current) setSource(data);
    } catch (error) {
      if (current === epoch.current) setError((error as Error).message);
    } finally {
      if (current === epoch.current) setBusy(false);
    }
  }, [api, articleId]);
  const show = useCallback(
    (id?: string) => {
      setSelected(id ?? null);
      setOpen(true);
      void refresh();
    },
    [refresh],
  );
  return { open, setOpen, source, selected, busy, error, dialog, show, refresh };
}
export type EvidenceModel = ReturnType<typeof useEvidence>;
