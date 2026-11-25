import { X, LoaderCircle } from 'lucide-react';
import type { Workbench } from './useWorkbench';
import { SourceEvidence } from './SourceEvidence';
import { CaptionReview } from './CaptionReview';
import './evidence.css';
export function EvidenceDialog({ model }: { model: Workbench }) {
  const { evidence, article } = model;
  const unresolved =
    evidence.review?.rows.filter((row) => row.changed && !row.confirmed).length ?? 0;
  return (
    <dialog
      ref={evidence.dialog}
      className="evidence-dialog"
      aria-labelledby="evidence-title"
      onCancel={(e) => {
        e.preventDefault();
        evidence.setOpen(false);
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) evidence.setOpen(false);
      }}
    >
      <header className="evidence-header">
        <div>
          <span className="eyebrow">SOURCE WORKSPACE</span>
          <h2 id="evidence-title">原文与校对</h2>
        </div>
        <button
          className="icon-button"
          aria-label="关闭原文面板"
          onClick={() => evidence.setOpen(false)}
        >
          <X size={21} />
        </button>
      </header>
      <div className="evidence-tabs">
        <button aria-pressed={evidence.tab === 'source'} onClick={() => evidence.setTab('source')}>
          原文依据
        </button>
        <button aria-pressed={evidence.tab === 'review'} onClick={() => evidence.setTab('review')}>
          字幕校对{unresolved > 0 && <span>{unresolved}</span>}
        </button>
      </div>
      {evidence.error && (
        <p className="evidence-error" role="alert">
          {evidence.error}
          <button className="text-button" onClick={() => evidence.refresh()}>
            刷新状态
          </button>
        </p>
      )}

      {evidence.busy && !evidence.source ? (
        <div className="summary-loading" role="status">
          <LoaderCircle className="spin" size={22} />
          正在读取原文…
        </div>
      ) : (
        <>
          <div hidden={evidence.tab !== 'source'}>
            <SourceEvidence key={article?.id} model={model} />
          </div>
          <div hidden={evidence.tab !== 'review'}>
            <CaptionReview key={article?.id} model={model} />
          </div>
        </>
      )}
    </dialog>
  );
}
