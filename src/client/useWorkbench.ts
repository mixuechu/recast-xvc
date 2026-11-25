import { useEffect, useRef, useState } from 'react';
import { splitArticle, videoId, type Article, type GenerationEvent, type Source } from '../shared';
import { captionText } from '../domain/captions';
import { readSSE } from '../protocol/sse';
import { useApi } from './api';
import { useEvidence } from './hooks/useEvidence';
import { useSummary } from './hooks/useSummary';
import { useMobilePanel } from './hooks/useMobilePanel';
type Saved = { id: string; title: string; createdAt: number };
type Config = {
  provider: string;
  model: string;
  configured: boolean;
  accessRequired: boolean;
};
export function useWorkbench() {
  const [mode, setMode] = useState<'youtube' | 'sample' | 'manual'>('youtube');
  const [url, setUrl] = useState('');
  const [transcript, setTranscript] = useState('');
  const [requirements, setRequirements] = useState('');
  const [article, setArticle] = useState<Article | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [config, setConfig] = useState<Config | null>(null);
  const [access, setAccess] = useState(
    () => sessionStorage.getItem('recast-access') ?? sessionStorage.getItem('shudu-access') ?? '',
  );
  const [history, setHistory] = useState<Saved[]>(() => {
    try {
      const data = JSON.parse(
        localStorage.getItem('recast-history') ?? localStorage.getItem('shudu-history') ?? '[]',
      );
      return Array.isArray(data)
        ? data.filter((x: Saved) => Date.now() - x.createdAt < 86400000).slice(0, 8)
        : [];
    } catch {
      return [];
    }
  });
  const [copied, setCopied] = useState(false);
  const panel = useMobilePanel();
  const { sidebar, setSidebar, mobile, sidebarRef } = panel;
  const currentId = useRef('');
  const restoreEpoch = useRef(0);
  const aborter = useRef<AbortController | null>(null);
  const chapters = article?.chapters.length
    ? article.chapters
    : splitArticle(article?.markdown ?? '');
  const intro = article?.markdown.split(/^##\s+/m)[0] ?? '';
  const api = useApi(access);
  const evidence = useEvidence(api, article?.id);
  const summaries = useSummary(api, article?.id);
  useEffect(() => {
    fetch('/api/config')
      .then((r) => r.json() as Promise<Config>)
      .then(setConfig)
      .catch(() => setError('无法连接服务，请刷新页面。'));
  }, []);
  useEffect(() => {
    localStorage.setItem('recast-history', JSON.stringify(history));
  }, [history]);
  const restore = async (id: string) => {
    if (busy) return;
    const epoch = ++restoreEpoch.current;
    setError('');
    setSidebar(false);
    try {
      const response = await api(`/api/sessions/${id}`);
      const data = (await response.json()) as Article;
      const source =
        data.source.kind === 'manual'
          ? ((await (await api(`/api/sessions/${id}/source`)).json()) as Source)
          : undefined;
      if (epoch !== restoreEpoch.current) return;
      setRequirements(data.requirements);
      setTranscript(source ? captionText(source.captions) : '');
      setArticle(data);
      setMode(
        data.source.kind === 'youtube'
          ? 'youtube'
          : data.source.kind === 'sample'
            ? 'sample'
            : 'manual',
      );
      if (data.source.videoId) setUrl(`https://www.youtube.com/watch?v=${data.source.videoId}`);
      currentId.current = id;
      setStatus(data.status === 'complete' ? '已完成' : '上次生成已中断');
    } catch (e) {
      if (epoch === restoreEpoch.current) setError((e as Error).message);
    }
  };
  const remember = (data: Article) =>
    setHistory((previous) =>
      [
        {
          id: data.id,
          title: /^#\s+(.+)$/m.exec(data.markdown)?.[1] ?? data.source.title,
          createdAt: data.createdAt,
        },
        ...previous.filter((x) => x.id !== data.id),
      ].slice(0, 8),
    );
  const start = async (sample = false, videoUrl?: string) => {
    if (busy) return;
    restoreEpoch.current++;
    const selected = videoUrl ? 'youtube' : sample ? 'sample' : mode;
    try {
      if (selected === 'youtube') videoId(videoUrl ?? url);
      if (selected === 'manual' && transcript.trim().length < 80)
        throw new Error('请粘贴至少 80 字的字幕。');
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    if (sample) setMode('sample');
    setError('');
    setBusy(true);
    setStatus('正在连接');
    setSidebar(false);
    setArticle(null);
    currentId.current = '';
    aborter.current = new AbortController();
    let complete = false;
    let next: Article | null = null;
    let frame: number | undefined;
    try {
      const response = await api('/api/generate', {
        method: 'POST',
        signal: aborter.current.signal,
        body: JSON.stringify({
          mode: selected,
          url: videoUrl ?? url,
          transcript,
          requirements,
        }),
      });
      if (!response.body) throw new Error('未收到生成响应，请重试。');
      for await (const payload of readSSE(response.body, aborter.current.signal)) {
        const data = JSON.parse(payload) as GenerationEvent;
        if (data.type === 'session') {
          currentId.current = data.id;
        } else if (data.type === 'status') {
          setStatus(data.message);
        } else if (data.type === 'error') {
          throw new Error(data.message);
        } else if (data.type === 'source') {
          next = {
            id: currentId.current,
            source: data,
            requirements,
            markdown: '',
            chapters: [],
            createdAt: Date.now(),
            expiresAt: Date.now() + 86400000,
            status: 'generating',
          };
          setArticle({ ...next });
          remember(next);
        } else if (data.type === 'delta' && next) {
          next.markdown += data.text;
          if (frame === undefined)
            frame = requestAnimationFrame(() => {
              if (next) setArticle({ ...next });
              frame = undefined;
            });
        } else if (data.type === 'done' && next) {
          next.chapters = data.chapters;
          next.expiresAt = data.expiresAt;
          next.status = 'complete';
          next.citationCount = data.citationCount;
          if (typeof data.markdown === 'string') next.markdown = data.markdown;
          complete = true;
          remember(next);
          setArticle({ ...next });
          setStatus('已完成');
        }
      }
      if (!complete && !aborter.current.signal.aborted)
        throw new Error('生成未完成，已保留当前内容。请重试。');
    } catch (e) {
      if ((e as Error).name === 'AbortError') setStatus('已停止');
      else {
        setError((e as Error).message);
        setStatus('生成中断');
      }
      if (next) {
        next.status = 'interrupted';
        setArticle({ ...next });
      }
    } finally {
      if (frame !== undefined) cancelAnimationFrame(frame);
      setBusy(false);
      aborter.current = null;
    }
  };
  const startRealExample = () => {
    const link = 'https://www.youtube.com/watch?v=nykOeWgQcHM';
    setMode('youtube');
    setUrl(link);
    void start(false, link);
  };
  const cancel = async () => {
    if (currentId.current)
      void api(`/api/sessions/${currentId.current}/cancel`, { method: 'POST' }).catch(() => {});
    aborter.current?.abort();
    setStatus('已停止');
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(article!.markdown);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('复制失败，请使用下载保存文章。');
    }
  };
  const download = () => {
    const blob = new Blob([article!.markdown], { type: 'text/markdown;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'Recast-article.md';
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  };
  const remove = async () => {
    if (!article || busy) return;
    try {
      await api(`/api/sessions/${article.id}`, { method: 'DELETE' });
      setHistory((prev) => prev.filter((x) => x.id !== article.id));
      setArticle(null);
      setStatus('');
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return {
    ...summaries,
    evidence,
    startRealExample,
    mode,
    setMode,
    url,
    setUrl,
    transcript,
    setTranscript,
    requirements,
    setRequirements,
    article,
    busy,
    status,
    error,
    setError,
    config,
    access,
    setAccess,
    history,
    copied,
    sidebar,
    setSidebar,
    mobile,
    sidebarRef,
    chapters,
    intro,
    restore,
    start,
    cancel,
    copy,
    download,
    remove,
  };
}
export type Workbench = ReturnType<typeof useWorkbench>;
