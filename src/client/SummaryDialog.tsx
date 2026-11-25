import { Sparkles, X, LoaderCircle } from 'lucide-react';
import type { Workbench } from './useWorkbench';
import { dimensions } from '../shared';
const labels = {
  Who: '谁参与',
  What: '讨论什么',
  When: '何时发生',
  Where: '涉及哪里',
  Why: '为何重要',
  How: '如何实现',
};
export function SummaryDialog({ model }: { model: Workbench }) {
  const {
    summaryId,
    summary,
    summaryBusy,
    summaryError,
    dialog,
    chapters,
    openSummary,
    closeSummary,
    evidence,
  } = model;
  return (
    <dialog
      ref={dialog}
      className="summary-dialog"
      onCancel={(e) => {
        e.preventDefault();
        closeSummary();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) closeSummary();
      }}
      aria-labelledby="summary-title"
    >
      <div className="summary-header">
        <span className="eyebrow">
          <Sparkles size={14} />
          章节透视 · 5W1H
        </span>
        <button className="icon-button" aria-label="关闭总结" onClick={closeSummary}>
          <X size={21} />
        </button>
      </div>
      <h2 id="summary-title">{chapters.find((c) => c.id === summaryId)?.title}</h2>
      <p className="summary-context">结合完整内容，聚焦当前章节。</p>
      {summaryBusy ? (
        <div className="summary-loading" role="status">
          <LoaderCircle size={24} className="spin" />
          <span>正在梳理六个关键问题…</span>
        </div>
      ) : summaryError ? (
        <div className="summary-error" role="alert">
          <p>{summaryError}</p>
          <button className="secondary" onClick={() => summaryId && openSummary(summaryId)}>
            重试总结
          </button>
        </div>
      ) : (
        summary && (
          <dl className="summary-list">
            {dimensions.map((key) => (
              <div key={key}>
                <dt>
                  <span>{key}</span>
                  {labels[key]}
                </dt>
                <dd>
                  {summary[key].text}
                  <div className="summary-citations">
                    {summary[key].citationIds.map((id, index) => (
                      <button
                        key={id}
                        onClick={() => {
                          closeSummary();
                          evidence.show(id);
                        }}
                      >
                        查看原文{summary[key].citationIds.length > 1 ? ` ${index + 1}` : ''}
                      </button>
                    ))}
                  </div>
                </dd>
              </div>
            ))}
          </dl>
        )
      )}
      <div className="summary-footer">未在对话中明确的信息，将标记为「未明确提及」。</div>
    </dialog>
  );
}
