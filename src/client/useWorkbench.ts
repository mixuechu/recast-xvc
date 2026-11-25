import { useEffect, useRef, useState } from 'react';
import { splitArticle, videoId, validateSummary, type Article, type Summary } from '../shared';
import { readSSE } from '../server/sse';
type Saved = { id: string; title: string; createdAt: number };
type Config = { provider: string; model: string; configured: boolean; accessRequired: boolean };
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
  const [access, setAccess] = useState(() => sessionStorage.getItem('shudu-access') ?? '');
  const [history, setHistory] = useState<Saved[]>(() => {
    try {
      const data = JSON.parse(localStorage.getItem('shudu-history') ?? '[]');
      return Array.isArray(data)
        ? data.filter((x: Saved) => Date.now() - x.createdAt < 86400000).slice(0, 8)
        : [];
    } catch {
      return [];
    }
  });
  const [summaryId, setSummaryId] = useState<string | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [summaryBusy, setSummaryBusy] = useState(false);
  const [summaryError, setSummaryError] = useState('');
  const [copied, setCopied] = useState(false);
  const [sidebar, setSidebar] = useState(false);
  const [mobile, setMobile] = useState(() => window.matchMedia('(max-width: 620px)').matches);
  const sidebarRef = useRef<HTMLElement>(null);
  const currentId = useRef('');
  const aborter = useRef<AbortController | null>(null);
  const summaryCache = useRef(new Map<string, Summary>());
  const summaryRequest = useRef(0);
  const dialog = useRef<HTMLDialogElement>(null);
  const lastFocus = useRef<HTMLElement | null>(null);
  const chapters = article?.chapters.length
    ? article.chapters
    : splitArticle(article?.markdown ?? '');
  const intro = article?.markdown.split(/^##\s+/m)[0] ?? '';
  const api = async (path: string, options: RequestInit = {}) => {
    const response = await fetch(path, {
      ...options,
      headers: { 'Content-Type': 'application/json', 'X-Access-Code': access, ...options.headers },
    });
    if (!response.ok) {
      let msg = '请求失败，请重试。';
      try {
        msg = ((await response.json()) as { error?: string }).error ?? msg;
      } catch {}
      throw new Error(msg);
    }
    return response;
  };
  useEffect(() => {
    fetch('/api/config')
      .then((r) => r.json() as Promise<Config>)
      .then(setConfig)
      .catch(() => setError('无法连接服务，请刷新页面。'));
  }, []);
  useEffect(() => {
    localStorage.setItem('shudu-history', JSON.stringify(history));
  }, [history]);
  useEffect(() => {
    if (summaryId) {
      lastFocus.current = document.activeElement as HTMLElement;
      dialog.current?.showModal();
    } else {
      dialog.current?.close();
      lastFocus.current?.focus();
    }
  }, [summaryId]);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 620px)');
    const update = () => setMobile(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    if (!mobile || !sidebar) return;
    const previous = document.activeElement as HTMLElement;
    const getControls = () => [
      ...(sidebarRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]),input:not([disabled]),textarea:not([disabled]),a[href]',
      ) ?? []),
    ];
    getControls()[0]?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setSidebar(false);
      }
      if (event.key === 'Tab') {
        const controls = getControls();
        const first = controls[0];
        const last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener('keydown', keydown);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', keydown);
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, [mobile, sidebar]);
  const restore = async (id: string) => {
    if (busy) return;
    setError('');
    setSidebar(false);
    try {
      const response = await api(`/api/sessions/${id}`);
      const data = (await response.json()) as Article & { summaries?: Record<string, Summary> };
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
      for (const [key, value] of Object.entries(data.summaries ?? {}))
        summaryCache.current.set(`${id}:${key}`, value as Summary);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const remember = (data: Article) =>
    setHistory((previous) =>
      [
        { id: data.id, title: data.source.title, createdAt: data.createdAt },
        ...previous.filter((x) => x.id !== data.id),
      ].slice(0, 8),
    );
  const start = async (sample = false) => {
    if (busy) return;
    const selected = sample ? 'sample' : mode;
    try {
      if (selected === 'youtube') videoId(url);
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
    try {
      const response = await api('/api/generate', {
        method: 'POST',
        signal: aborter.current.signal,
        body: JSON.stringify({ mode: selected, url, transcript, requirements }),
      });
      if (!response.body) throw new Error('未收到生成响应，请重试。');
      for await (const payload of readSSE(response.body, aborter.current.signal)) {
        const data = JSON.parse(payload);
        if (data.id) {
          currentId.current = data.id;
        } else if (data.message) {
          if (data.message === '生成已停止，已生成内容会保留。') setStatus('已停止');
          else if (data.message.includes('正在')) setStatus(data.message);
          else throw new Error(data.message);
        } else if (data.kind) {
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
        } else if (typeof data.text === 'string' && next) {
          next.markdown += data.text;
          setArticle({ ...next });
        } else if (data.chapters && next) {
          next.chapters = data.chapters;
          next.expiresAt = data.expiresAt;
          next.status = 'complete';
          complete = true;
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
      setBusy(false);
      aborter.current = null;
    }
  };
  const cancel = async () => {
    if (currentId.current)
      void api(`/api/sessions/${currentId.current}/cancel`, { method: 'POST' }).catch(() => {});
    aborter.current?.abort();
    setStatus('已停止');
  };
  const openSummary = async (id: string) => {
    summaryRequest.current++;
    const sequence = summaryRequest.current;
    setSummaryId(id);
    setSummary(null);
    setSummaryError('');
    const key = `${article!.id}:${id}`;
    const cached = summaryCache.current.get(key);
    if (cached) {
      setSummary(cached);
      setSummaryBusy(false);
      return;
    }
    setSummaryBusy(true);
    try {
      const response = await api(`/api/sessions/${article!.id}/summary`, {
        method: 'POST',
        body: JSON.stringify({ chapterId: id }),
      });
      const data = validateSummary(await response.json());
      summaryCache.current.set(key, data);
      if (sequence === summaryRequest.current) setSummary(data);
    } catch (e) {
      if (sequence === summaryRequest.current) setSummaryError((e as Error).message);
    } finally {
      if (sequence === summaryRequest.current) setSummaryBusy(false);
    }
  };
  const closeSummary = () => {
    summaryRequest.current++;
    setSummaryId(null);
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
    link.download = '述读文章.md';
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
    summaryId,
    summary,
    summaryBusy,
    summaryError,
    copied,
    sidebar,
    setSidebar,
    mobile,
    sidebarRef,
    dialog,
    chapters,
    intro,
    restore,
    start,
    cancel,
    openSummary,
    closeSummary,
    copy,
    download,
    remove,
  };
}
export type Workbench = ReturnType<typeof useWorkbench>;
