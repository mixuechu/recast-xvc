import { X, LoaderCircle } from 'lucide-react';
import type { Workbench } from './useWorkbench';
import { SourceEvidence } from './SourceEvidence';
import './evidence.css';
export function EvidenceDialog({ model }: { model: Workbench }) {
  const { evidence, article } = model;
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
          <span className="eyebrow">SOURCE EVIDENCE</span>
          <h2 id="evidence-title">原文依据</h2>
        </div>
        <button
          className="icon-button"
          aria-label="关闭原文面板"
          onClick={() => evidence.setOpen(false)}
        >
          <X size={21} />
        </button>
      </header>
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
      ) : evidence.source ? (
        <SourceEvidence key={article?.id} model={model} />
      ) : null}
    </dialog>
  );
}
