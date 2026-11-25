import { useCallback, useEffect, useRef, useState } from 'react';
import type { Source, Review, ReviewDecision, Recognition, AudioUpload } from '../../shared';
import type { Api } from '../api';
export function useEvidence(api: Api, articleId?: string) {
  const [tab, setTab] = useState<'source' | 'review'>('source');
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState<Source | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [recognition, setRecognition] = useState<Recognition | null>(null);
  const [audio, setAudio] = useState<AudioUpload | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [drafts, setDrafts] = useState<Record<string, { decision: ReviewDecision; text?: string }>>(
    {},
  );
  useEffect(() => {
    if (Object.keys(drafts).length) setError('候选字幕版本已更新，请重新确认未保存的修改。');
    setDrafts({});
  }, [review?.version]);
  const dialog = useRef<HTMLDialogElement>(null),
    epoch = useRef(0);
  useEffect(() => {
    epoch.current++;
    setOpen(false);
    setSource(null);
    setReview(null);
    setRecognition(null);
    setAudio(null);
    setDrafts({});
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
      const responses = await Promise.all([
        api(`/api/sessions/${articleId}/source`),
        api(`/api/sessions/${articleId}/review`),
        api(`/api/sessions/${articleId}/recognition`),
        api(`/api/sessions/${articleId}/audio`),
      ]);
      const [src, rev, task, media] = await Promise.all(responses.map((r) => r.json()));
      if (current !== epoch.current) return;
      setSource(src as Source);
      setReview(rev as Review | null);
      setRecognition(task as Recognition | null);
      setAudio(media as AudioUpload | null);
    } catch (e) {
      if (current === epoch.current) setError((e as Error).message);
    } finally {
      if (current === epoch.current) setBusy(false);
    }
  }, [api, articleId]);
  const show = useCallback(
    (id?: string, mode: 'source' | 'review' = 'source') => {
      setSelected(id ?? null);
      setTab(mode);
      setOpen(true);
      void refresh();
    },
    [refresh],
  );
  useEffect(() => {
    if (!open || !recognition || !['queued', 'running'].includes(recognition.status)) return;
    let stopped = false;
    const poll = async () => {
      try {
        const response = await api(`/api/sessions/${articleId}/recognition`);
        const task = (await response.json()) as Recognition;
        if (stopped) return;
        // Fetch the result before publishing a terminal status: changing the status
        // disposes this polling effect, which must not discard its own review response.
        let completedReview: Review | undefined;
        if (task?.status === 'complete') {
          const r = await api(`/api/sessions/${articleId}/review`);
          completedReview = (await r.json()) as Review;
        }
        if (stopped) return;
        if (completedReview) setReview(completedReview);
        setRecognition(task);
      } catch (e) {
        if (!stopped) setError((e as Error).message);
      }
    };
    const timer = setInterval(() => void poll(), 5000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [open, recognition?.status, api, articleId]);
  const operation = async (path: string, input: unknown, method = 'POST') => {
    if (!articleId) return;
    const current = epoch.current;
    setBusy(true);
    setError('');
    try {
      const r = await api(`/api/sessions/${articleId}/${path}`, {
        method,
        body: method === 'DELETE' ? undefined : JSON.stringify(input),
      });
      const data = await r.json();
      if (current !== epoch.current) return;
      if (path === 'review') {
        setReview(data as Review);
        setDrafts({});
      } else setRecognition(method === 'DELETE' ? null : (data as Recognition));
    } catch (e) {
      if (current === epoch.current) setError((e as Error).message);
    } finally {
      if (current === epoch.current) setBusy(false);
    }
  };
  const save = () =>
    operation('review', {
      action: 'resolve',
      version: review?.version,
      changes: Object.entries(drafts).map(([id, value]) => ({ id, ...value })),
    });
  const importTranscript = (transcript: string) =>
    operation('review', { action: 'import', transcript });
  const recognize = (audioUrl: string, format?: string) =>
    operation('recognition', { audioUrl, format });
  const recognizeFile = async (file: File) => {
    if (!articleId) return;
    const current = epoch.current;
    setBusy(true);
    setError('');
    try {
      if (file.size > 24 * 1024 * 1024) throw new Error('音频最多支持 24 MB。');
      const response = await api(`/api/sessions/${articleId}/audio`, {
        method: 'POST',
        body: file,
        headers: {
          'Content-Type': 'application/octet-stream',
          'X-Audio-Filename': encodeURIComponent(file.name),
        },
      });
      const uploaded = (await response.json()) as AudioUpload;
      if (current !== epoch.current) return;
      setAudio(uploaded);
      const result = await api(`/api/sessions/${articleId}/recognition`, {
        method: 'POST',
        body: JSON.stringify({ audioUrl: uploaded.url, format: uploaded.format }),
      });
      const task = (await result.json()) as Recognition;
      if (current === epoch.current) setRecognition(task);
    } catch (e) {
      if (current === epoch.current) setError((e as Error).message);
    } finally {
      if (current === epoch.current) setBusy(false);
    }
  };
  const resumeRecognition = () => operation('recognition', { action: 'resume' });
  const stopRecognition = () => operation('recognition', null, 'DELETE');
  const choose = (id: string, decision: ReviewDecision, text?: string) =>
    setDrafts((previous) => ({ ...previous, [id]: { decision, text } }));
  const chooseAll = (decision: 'original' | 'candidate') => {
    if (!review) return;
    setDrafts(
      Object.fromEntries(
        review.rows
          .filter((row) => row.changed)
          .map((row) => [
            row.id,
            { decision: row[decision] ? decision : row.original ? 'original' : 'candidate' },
          ]),
      ),
    );
  };
  return {
    tab,
    setTab,
    open,
    setOpen,
    source,
    review,
    recognition,
    audio,
    recognizeFile,
    selected,
    busy,
    error,
    drafts,
    dialog,
    show,
    refresh,
    save,
    importTranscript,
    recognize,
    stopRecognition,
    resumeRecognition,
    choose,
    chooseAll,
  };
}
export type EvidenceModel = ReturnType<typeof useEvidence>;
