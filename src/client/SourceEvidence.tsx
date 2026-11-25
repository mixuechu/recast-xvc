import { useEffect, useState } from 'react';
import { Search, ExternalLink } from 'lucide-react';
import type { Workbench } from './useWorkbench';
import { clock } from '../domain/captions';
export function SourceEvidence({ model }: { model: Pick<Workbench, 'evidence' | 'article'> }) {
  const { evidence, article } = model;
  const [query, setQuery] = useState('');
  useEffect(() => setQuery(''), [evidence.selected, evidence.open]);
  useEffect(() => {
    if (evidence.open && evidence.tab === 'source' && evidence.selected && evidence.source)
      requestAnimationFrame(() =>
        document
          .getElementById(`evidence-${evidence.selected}`)
          ?.scrollIntoView({ block: 'center' }),
      );
  }, [evidence.open, evidence.tab, evidence.selected, evidence.source]);
  const captions =
    evidence.source?.captions.filter(
      (c) => !query || c.text.toLowerCase().includes(query.toLowerCase()),
    ) ?? [];
  return (
    <>
      <div className="source-info">
        <strong>{evidence.source?.title}</strong>
        {evidence.source?.sourceUrl && (
          <a
            className="publisher-link"
            href={evidence.source.sourceUrl}
            target="_blank"
            rel="noreferrer"
          >
            字幕出处
            <ExternalLink size={12} />
          </a>
        )}
        <span>
          {evidence.source?.provider === 'publisher'
            ? '视频发布方官方字幕'
            : evidence.source?.provider === 'reviewed'
              ? '人工确认的校对版本'
              : evidence.source?.provider === 'sample'
                ? '原创示例'
                : evidence.source?.provider === 'manual'
                  ? '手动导入'
                  : 'YouTube 字幕'}
        </span>
        {evidence.source?.notice && <p>{evidence.source.notice}</p>}
        {evidence.source?.license && <small>{evidence.source.license}</small>}
      </div>
      <label className="source-search">
        <Search size={16} />
        <span className="sr-only">搜索字幕</span>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索原文中的关键词"
        />
      </label>
      <div className="source-captions">
        {captions.length ? (
          captions.map((c) => (
            <section
              key={c.id}
              id={`evidence-${c.id}`}
              className={`source-cue ${evidence.selected === c.id ? 'is-highlighted' : ''}`}
            >
              <div className="cue-meta">
                <span>片段 {Number(c.id?.slice(1))}</span>
                {c.duration > 0 ? (
                  <a
                    href={
                      article?.source.videoId
                        ? `https://www.youtube.com/watch?v=${article.source.videoId}&t=${Math.floor(c.offset)}`
                        : undefined
                    }
                    target="_blank"
                    rel="noreferrer"
                  >
                    {clock(c.offset)}
                    {article?.source.videoId && <ExternalLink size={12} />}
                  </a>
                ) : (
                  <span>无时间轴</span>
                )}
                {c.speaker && <span>{c.speaker}</span>}
              </div>
              <p>{c.text}</p>
            </section>
          ))
        ) : (
          <p className="panel-empty">没有匹配的字幕。</p>
        )}
      </div>
    </>
  );
}
