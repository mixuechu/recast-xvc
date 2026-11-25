import { Link2, Sparkles, FileText, X, Play, Square } from 'lucide-react';
import type { Workbench } from './useWorkbench';
export function SourcePanel({ model }: { model: Workbench }) {
  const {
    mode,
    setMode,
    url,
    setUrl,
    transcript,
    setTranscript,
    setError,
    error,
    requirements,
    setRequirements,
    article,
    busy,
    config,
    access,
    setAccess,
    history,
    sidebar,
    setSidebar,
    mobile,
    sidebarRef,
    restore,
    start,
    cancel,
  } = model;
  return (
    <aside
      ref={sidebarRef}
      inert={mobile && !sidebar}
      role={mobile && sidebar ? 'dialog' : undefined}
      aria-modal={mobile && sidebar ? true : undefined}
      aria-label="素材与要求"
      className={`sidebar ${sidebar ? 'is-open' : ''}`}
    >
      <div className="side-heading">
        <span>素材与要求</span>
        <button
          className="icon-button drawer-close"
          aria-label="关闭素材面板"
          onClick={() => setSidebar(false)}
        >
          <X size={18} />
        </button>
        <span className="tiny-label">WORKSPACE</span>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void start();
        }}
      >
        <div className="tabs" aria-label="字幕来源">
          <button
            type="button"
            disabled={busy}
            aria-pressed={mode === 'youtube'}
            className={mode === 'youtube' ? 'active' : ''}
            onClick={() => setMode('youtube')}
          >
            <Link2 size={15} />
            视频链接
          </button>
          <button
            type="button"
            disabled={busy}
            aria-pressed={mode === 'manual'}
            className={mode === 'manual' ? 'active' : ''}
            onClick={() => setMode('manual')}
          >
            <FileText size={15} />
            粘贴字幕
          </button>
        </div>
        {mode === 'youtube' ? (
          <div className="field">
            <label htmlFor="video">YouTube 视频链接</label>
            <input
              id="video"
              type="url"
              placeholder="https://www.youtube.com/watch?v=…"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              disabled={busy}
            />
            <p className="hint">支持公开视频的人工字幕与自动字幕。</p>
          </div>
        ) : mode === 'manual' ? (
          <div className="field">
            <label htmlFor="transcript">字幕内容</label>
            <textarea
              id="transcript"
              className="transcript"
              value={transcript}
              onChange={(e) => setTranscript(e.target.value)}
              maxLength={100000}
              placeholder="粘贴字幕或带时间戳的对话文本，至少 80 字。"
              disabled={busy}
            />
            <span className="hint">{transcript.length.toLocaleString()} / 100,000 字</span>
            <label className="file-button">
              导入字幕文件
              <input
                type="file"
                accept=".srt,.vtt,.txt,text/plain,text/vtt"
                disabled={busy}
                onChange={async (event) => {
                  const file = event.target.files?.[0];
                  event.target.value = '';
                  if (!file) return;
                  if (file.size > 300000) {
                    setError('字幕文件最多 300 KB。');
                    return;
                  }
                  try {
                    setTranscript(await file.text());
                    setError('');
                  } catch {
                    setError('无法读取文件，请重新选择。');
                  }
                }}
              />
            </label>
          </div>
        ) : (
          <div className="selected-sample">
            <span className="eyebrow">内置示例</span>
            <strong>AI 产品的第一公里</strong>
            <p>原创示例访谈，用于体验完整生成流程。</p>
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => setMode('youtube')}
            >
              换成我的视频
            </button>
          </div>
        )}
        <div className="field requirements">
          <label htmlFor="requirements">
            你希望怎样整理？<span>可选</span>
          </label>
          <textarea
            id="requirements"
            maxLength={2000}
            disabled={busy}
            value={requirements}
            onChange={(e) => setRequirements(e.target.value)}
            placeholder="例如：面向产品经理，保留对话形式，重点梳理商业判断，控制在 1500 字以内。"
          />
          <div className="presets">
            {['保留深度对话', '写给初学者', '提炼行动清单'].map((p, i) => (
              <button
                key={p}
                type="button"
                disabled={busy}
                onClick={() =>
                  setRequirements(
                    [
                      '保留深度对话形式，保留关键论证和不同观点。',
                      '面向初学者，解释专业术语，语言清晰易懂。',
                      '整理成可执行的行动清单，按主题分章，不添加字幕没有的建议。',
                    ][i],
                  )
                }
              >
                {p}
              </button>
            ))}
          </div>
        </div>
        {config?.accessRequired && (
          <div className="field">
            <label htmlFor="access">访问码</label>
            <input
              id="access"
              type="password"
              value={access}
              onChange={(e) => {
                setAccess(e.target.value);
                sessionStorage.setItem('recast-access', e.target.value);
              }}
              autoComplete="off"
            />
          </div>
        )}
        {mobile && sidebar && error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {busy ? (
          <button type="button" className="primary stop" onClick={cancel}>
            <Square size={15} />
            停止生成
          </button>
        ) : (
          <button className="primary" type="submit" disabled={!config || !config.configured}>
            <Sparkles size={17} />
            生成文章
          </button>
        )}
        {config && !config.configured && (
          <p className="inline-warning">模型尚未配置，请在服务端添加 API 密钥。</p>
        )}
        <p className="privacy-note">文章保留 24 小时，可随时下载或删除。</p>
      </form>
      <button
        className="sample-link"
        disabled={busy || !config?.configured}
        onClick={() => start(true)}
      >
        <Play size={15} />
        <span>没有链接？试试内置示例</span>
      </button>
      {history.length > 0 && (
        <section className="history">
          <div className="side-heading">
            <span>最近整理</span>
            <span className="count">{history.length}</span>
          </div>
          {history.map((item) => (
            <button
              disabled={busy}
              className={`history-item ${article?.id === item.id ? 'selected' : ''}`}
              key={item.id}
              onClick={() => restore(item.id)}
            >
              <FileText size={16} />
              <span>{item.title}</span>
            </button>
          ))}
        </section>
      )}
      <div className="side-footer">
        <span className="provider-mark">AI</span>
        <span>
          {config?.provider === 'gemini' ? 'Gemini' : '智谱 GLM'} 驱动
          <span className="footer-sub">忠于原意，保留思考</span>
        </span>
      </div>
    </aside>
  );
}
