import { useEffect, useRef, useState } from 'react';
import {
  splitArticle,
  videoId,
  type Article,
  type GenerationEvent,
  type Source,
  type GenerationStage,
} from '../shared';
import { captionText } from '../domain/captions';
import { readSSE } from '../protocol/sse';
import { useApi } from './api';
import { readReloadDraft, reloadDraftKey } from './reload-draft';
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
  const [reloadDraft] = useState(readReloadDraft);
  const [mode, setMode] = useState<'youtube' | 'sample' | 'manual'>(reloadDraft?.mode ?? 'youtube');
  const [url, setUrl] = useState(reloadDraft?.url ?? '');
  const [transcript, setTranscript] = useState(reloadDraft?.transcript ?? '');
  const [requirements, setRequirements] = useState(reloadDraft?.requirements ?? '');
  const [article, setArticle] = useState<Article | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [generationStage, setGenerationStage] = useState<GenerationStage>('source');
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
    // 切换记录或开始生成后，忽略此前恢复请求的迟到响应。
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
      setError(data.failure ?? '');
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
  useEffect(() => {
    if (!reloadDraft) return;
    const recover = async () => {
      if (reloadDraft.articleId) await restore(reloadDraft.articleId);
      // restore 会恢复文章原有要求；随后还原刷新前尚未提交的输入。
      setMode(reloadDraft.mode);
      setUrl(reloadDraft.url);
      setTranscript(reloadDraft.transcript);
      setRequirements(reloadDraft.requirements);
      sessionStorage.removeItem(reloadDraftKey);
    };
    void recover();
  }, [reloadDraft]);
  const reload = () => {
    if (busy) return;
    try {
      sessionStorage.setItem(
        reloadDraftKey,
        JSON.stringify({ mode, url, transcript, requirements, articleId: article?.id }),
      );
      window.location.reload();
    } catch {
      setError('无法保存当前输入，请先下载稿件并复制输入，再手动刷新。');
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
  const run = async (path: string, payload?: object, seed?: Article) => {
    if (aborter.current) return;
    restoreEpoch.current++;
    setError('');
    setBusy(true);
    setStatus(seed ? '正在继续整理初稿' : '正在连接');
    setGenerationStage(seed?.processingStage ?? 'source');
    setSidebar(false);
    setArticle(seed ? { ...seed, status: 'generating' } : null);
    currentId.current = seed?.id ?? '';
    aborter.current = new AbortController();
    let complete = false;
    let next: Article | null = seed ? { ...seed, status: 'generating' } : null;
    let frame: number | undefined;
    try {
      if (seed) {
        setRequirements(seed.requirements);
        setMode(
          seed.source.kind === 'manual'
            ? 'manual'
            : seed.source.kind === 'sample'
              ? 'sample'
              : 'youtube',
        );
        if (seed.source.videoId) setUrl(`https://www.youtube.com/watch?v=${seed.source.videoId}`);
        if (seed.source.kind === 'manual') {
          const source = (await (
            await api(`/api/sessions/${seed.id}/source`, { signal: aborter.current.signal })
          ).json()) as Source;
          setTranscript(captionText(source.captions));
        }
      }
      const response = await api(path, {
        method: 'POST',
        signal: aborter.current.signal,
        ...(payload ? { body: JSON.stringify(payload) } : {}),
      });
      if (!response.body) throw new Error('未收到生成响应，请重试。');
      for await (const eventData of readSSE(response.body, aborter.current.signal)) {
        const data = JSON.parse(eventData) as GenerationEvent;
        if (data.type === 'session') {
          currentId.current = data.id;
        } else if (data.type === 'status') {
          setStatus(data.message);
          if (data.stage) setGenerationStage(data.stage);
        } else if (data.type === 'checkpoint' && next) {
          next.markdown = data.markdown;
          next.chapters = splitArticle(data.markdown);
          next.processingStage = data.stage;
          setGenerationStage(data.stage);
          remember(next);
          setArticle({ ...next });
        } else if (data.type === 'error') {
          if (next && data.canResume === false) delete next.processingStage;
          throw new Error(data.message);
        } else if (data.type === 'source') {
          next = {
            id: currentId.current,
            source: data,
            requirements: (payload as { requirements?: string })?.requirements ?? '',
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
          delete next.processingStage;
          delete next.failure;
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
        if ((e as Error).name !== 'AbortError') next.failure = (e as Error).message;
        remember(next);
        setArticle({ ...next });
      }
    } finally {
      if (frame !== undefined) cancelAnimationFrame(frame);
      setBusy(false);
      aborter.current = null;
    }
  };
  const start = async (sample = false, videoUrl?: string) => {
    if (busy || aborter.current) return;
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
    await run('/api/generate', { mode: selected, url: videoUrl ?? url, transcript, requirements });
  };
  const resume = async () => {
    if (!article?.processingStage || article.status !== 'interrupted' || busy) return;
    await run(`/api/sessions/${article.id}/resume`, undefined, article);
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
    reload,
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
    resume,
    generationStage,
    cancel,
    copy,
    download,
    remove,
  };
}
export type Workbench = ReturnType<typeof useWorkbench>;
