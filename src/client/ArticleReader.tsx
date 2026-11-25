import {
  BookOpen,
  Link2,
  Sparkles,
  Check,
  Copy,
  Download,
  X,
  LoaderCircle,
  RotateCcw,
  Play,
  ChevronDown,
  ExternalLink,
  Trash2,
} from 'lucide-react';
import type { Workbench } from './useWorkbench';
import { Markdown } from './Markdown';
import { readableLength } from '../domain/requirements';
export function ArticleReader({ model }: { model: Workbench }) {
  const {
    article,
    busy,
    status,
    error,
    setError,
    config,
    copied,
    sidebar,
    setSidebar,
    mobile,
    chapters,
    intro,
    start,
    openSummary,
    copy,
    download,
    remove,
    evidence,
    startRealExample,
  } = model;
  return (
    <main inert={mobile && sidebar} className="main" id="main">
      <div className="reading-toolbar">
        <div className="breadcrumb">
          <BookOpen size={16} />
          <span>阅读空间</span>
          {article && (
            <>
              <span className="divider">/</span>
              <span className="crumb-title">
                {article.source.kind === 'sample'
                  ? '示例访谈'
                  : article.source.kind === 'manual'
                    ? '导入字幕'
                    : '视频文章'}
              </span>
            </>
          )}
        </div>
        {article?.markdown && (
          <div className="tools">
            <button title="复制 Markdown" aria-label="复制 Markdown" onClick={copy}>
              {copied ? <Check size={17} /> : <Copy size={17} />}
            </button>
            <button title="下载 Markdown" aria-label="下载 Markdown" onClick={download}>
              <Download size={17} />
            </button>
            <button disabled={busy} title="删除文章" aria-label="删除文章" onClick={remove}>
              <Trash2 size={17} />
            </button>
          </div>
        )}
      </div>
      {error && (
        <div className="error-banner" role="alert">
          <div>
            <strong>这次没有顺利完成</strong>
            <p>{error}</p>
          </div>
          <button className="icon-button" aria-label="关闭错误提示" onClick={() => setError('')}>
            <X size={18} />
          </button>
        </div>
      )}
      {article && !busy && (
        <div className="evidence-entry">
          <button onClick={() => evidence.show()}>
            查看原文依据<span>{article.citationCount ?? 0} 条原文</span>
          </button>
          <button onClick={() => evidence.show(undefined, 'review')}>校对字幕</button>
        </div>
      )}
      {!article && !busy ? (
        <div className="empty-state">
          <div className="editorial-kicker">
            <span /> VIDEO TO ARTICLE
          </div>
          <h1>
            让一段好对话，
            <br />
            有第二种打开方式。
          </h1>
          <p className="empty-description">
            从视频字幕出发，留住观点、追问与细节。
            <br className="desktop-br" />
            读成文章，再把每一章读得更深。
          </p>
          <button className="primary mobile-start" onClick={() => setSidebar(true)}>
            <Link2 size={17} />
            整理我的视频
          </button>
          <button
            className="empty-example"
            disabled={!config?.configured}
            onClick={startRealExample}
          >
            <div className="example-art">
              <div className="wave">
                {[14, 22, 34, 18, 42, 30, 50, 26, 38, 18, 30, 14].map((h, i) => (
                  <span key={i} style={{ height: h }} />
                ))}
              </div>
              <span className="play-circle">
                <Play size={18} fill="currentColor" />
              </span>
            </div>
            <div className="example-copy">
              <span className="eyebrow">试读一段真实课程</span>
              <strong>MIT · What is Computation?</strong>
              <span>真实视频 · 英文原文 · 中文整理</span>
            </div>
            <span className="example-action">
              试读
              <Play size={13} />
            </span>
          </button>
          <div className="reading-notes">
            <div>
              <span className="note-number">01</span>
              <span>保留对话的来龙去脉</span>
            </div>
            <div>
              <span className="note-number">02</span>
              <span>按主题梳理成章</span>
            </div>
            <div>
              <span className="note-number">03</span>
              <span>用 5W1H 读懂关键</span>
            </div>
          </div>
          <div className="empty-bottom">为认真听过、还想再想一遍的内容。</div>
        </div>
      ) : (
        <>
          <div className="article-layout">
            <div className="article-column">
              <div className="article-meta">
                <span className="source-badge">
                  {article?.source.kind === 'sample'
                    ? '原创示例'
                    : article?.source.kind === 'manual'
                      ? '导入字幕'
                      : 'YOUTUBE'}
                </span>
                <span
                  className={busy ? 'generation-status busy' : 'generation-status'}
                  role="status"
                >
                  {busy && <LoaderCircle size={13} className="spin" />}
                  {status}
                </span>
                {article?.markdown && (
                  <span className="word-count">
                    {readableLength(article.markdown).toLocaleString()} 字
                  </span>
                )}
              </div>
              {article?.source.videoId && (
                <a
                  className="source-link"
                  href={`https://www.youtube.com/watch?v=${article.source.videoId}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {article.source.title}
                  <ExternalLink size={13} />
                </a>
              )}
              {article?.source.kind === 'sample' && (
                <p className="source-disclosure">此素材为原创示例对话，不是指定参考视频的字幕。</p>
              )}
              {article?.source.notice && <p className="source-notice">{article.source.notice}</p>}
              {article?.parentId && (
                <p className="source-disclosure">由已确认的校对版本生成，原文章仍在最近整理中。</p>
              )}
              {article?.requirements && (
                <details className="applied-requirements">
                  <summary>
                    本次生成要求
                    <ChevronDown size={13} />
                  </summary>
                  <p>{article.requirements}</p>
                </details>
              )}
              {!article?.markdown ? (
                busy ? (
                  <div className="skeleton" aria-label="正在整理文章">
                    <span />
                    <span />
                    <span />
                    <span />
                    <p>正在为这段对话梳理脉络…</p>
                  </div>
                ) : (
                  <div className="interrupted-empty">
                    <h2>暂时未能生成文章</h2>
                    <p>可以重试，或换一份字幕继续整理。</p>
                    <button className="secondary" onClick={() => start()}>
                      <RotateCcw size={15} />
                      重新生成
                    </button>
                  </div>
                )
              ) : (
                <article>
                  <Markdown text={intro} onCitation={(id) => evidence.show(id)} />
                  {chapters.map((chapter) => (
                    <section key={chapter.id} id={chapter.id} className="chapter">
                      <div className="chapter-heading">
                        <h2>{chapter.title}</h2>
                        <button
                          disabled={busy || article.status !== 'complete'}
                          onClick={() => openSummary(chapter.id)}
                          title={busy ? '文章完成后可总结' : '查看章节 5W1H'}
                        >
                          <Sparkles size={13} />
                          5W1H
                        </button>
                      </div>
                      <Markdown text={chapter.markdown} onCitation={(id) => evidence.show(id)} />
                    </section>
                  ))}
                  {busy && <span className="stream-cursor" aria-hidden="true" />}
                </article>
              )}
              {!busy && article?.markdown && (
                <div className="article-end">
                  <span>{article.status === 'complete' ? '全文完' : '内容未完整生成'}</span>
                  <p>AI 整理可能存在疏漏，重要信息请核对原始字幕。</p>
                  {article.status !== 'complete' && (
                    <button className="secondary" onClick={() => start()}>
                      <RotateCcw size={15} />
                      重新生成
                    </button>
                  )}
                </div>
              )}
            </div>
            <nav className="outline" aria-label="文章目录">
              <span className="eyebrow">本篇目录</span>
              {chapters.length ? (
                chapters.map((chapter, i) => (
                  <a key={chapter.id} href={`#${chapter.id}`}>
                    <span>{String(i + 1).padStart(2, '0')}</span>
                    {chapter.title}
                  </a>
                ))
              ) : (
                <p>章节将在生成后出现</p>
              )}
              {chapters.length > 0 && (
                <div className="outline-tip">
                  <Sparkles size={15} />
                  <p>
                    点击章节旁的 5W1H，
                    <br />
                    展开六个维度的总结。
                  </p>
                </div>
              )}
            </nav>
          </div>
        </>
      )}
    </main>
  );
}
