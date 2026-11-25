import { useEffect, useMemo, useState, useRef } from 'react';
import { Check, Upload, LoaderCircle, FileSearch, ExternalLink } from 'lucide-react';
import type { Workbench } from './useWorkbench';
import type { ComparisonRow, ReviewDecision } from '../shared';
import { clock } from '../domain/captions';
import { RecognitionInput } from './RecognitionInput';
import { textDiff } from '../domain/text-diff';
export function CaptionReview({
  model,
}: {
  model: Pick<Workbench, 'evidence' | 'article' | 'generateReviewed' | 'config' | 'busy'>;
}) {
  const { evidence, article, generateReviewed } = model;
  const [candidate, setCandidate] = useState(''),
    [fileError, setFileError] = useState(''),
    [onlyChanges, setOnlyChanges] = useState(true),
    [page, setPage] = useState(1);
  const player = useRef<HTMLAudioElement>(null);
  const [listenAt, setListenAt] = useState<number>();
  const playAt = (offset: number) => {
    setListenAt(offset);
    if (player.current) {
      player.current.currentTime = offset;
      void player.current.play().catch(() => {});
    }
  };
  useEffect(() => setPage(1), [evidence.review?.createdAt]);
  const rows = evidence.review?.rows.filter((r) => !onlyChanges || r.changed) ?? [];
  const unresolved = evidence.review?.rows.filter((r) => r.changed && !r.confirmed).length ?? 0;
  const drafts = Object.keys(evidence.drafts).length;
  const running =
    evidence.recognition && ['queued', 'running'].includes(evidence.recognition.status);
  const readFile = async (file?: File) => {
    if (!file) return;
    setFileError('');
    if (file.size > 300000) {
      setFileError('字幕文件最多 300 KB。');
      return;
    }
    try {
      setCandidate(await file.text());
    } catch {
      setFileError('文件读取失败，请重新选择。');
    }
  };
  return (
    <div className="review-workspace">
      {fileError && (
        <p className="evidence-error" role="alert">
          {fileError}
        </p>
      )}
      <p className="review-intro">
        比较两份同一音频的字幕，逐段确认分歧。系统标记差异，不自动判定哪一份更准确。
      </p>
      <RecognitionInput model={model} running={!!running} />
      {evidence.audio && (
        <div className="review-audio">
          <span>
            已上传音轨 · {evidence.audio.filename}
            {listenAt !== undefined && ` · 回听 ${clock(listenAt)}`}
          </span>
          <audio
            ref={player}
            controls
            preload="none"
            src={evidence.audio.url}
            aria-label="校对音频"
            onLoadedMetadata={() => {
              if (listenAt !== undefined && player.current) player.current.currentTime = listenAt;
            }}
          />
        </div>
      )}
      {evidence.recognition?.taskId && (
        <details className="task-details">
          <summary>识别任务详情</summary>
          <p>
            任务编号：<code>{evidence.recognition.taskId}</code>
          </p>
          <p>向服务商排查时可使用此编号；它不包含 API 密钥。</p>
        </details>
      )}
      {evidence.recognition && (
        <div className="recognition-status" role="status">
          {running ? (
            <>
              <LoaderCircle size={16} className="spin" />
              {evidence.recognition.status === 'queued' ? '服务商排队中' : '识别处理中'}
              ，可关闭面板后稍后查看。
              <button className="text-button" onClick={() => evidence.stopRecognition()}>
                停止等待
              </button>
            </>
          ) : evidence.recognition.status === 'complete' ? (
            '辅助识别完成，差异已列在下方。'
          ) : evidence.recognition.status === 'failed' ? (
            <>
              {evidence.recognition.error}
              <button className="text-button" onClick={() => evidence.resumeRecognition()}>
                重试查询
              </button>
            </>
          ) : (
            <>
              已停止等待。已提交的服务端任务可能仍会产生费用。
              <button className="text-button" onClick={() => evidence.resumeRecognition()}>
                继续查询
              </button>
            </>
          )}
        </div>
      )}
      <details className="candidate-import" open={!evidence.review && !running}>
        <summary>
          <Upload size={15} />
          导入第二份字幕
        </summary>
        <label htmlFor="candidate">SRT / VTT 字幕</label>
        <textarea
          id="candidate"
          rows={4}
          maxLength={300000}
          value={candidate}
          onChange={(e) => setCandidate(e.target.value)}
          placeholder="粘贴与原文相同语言、带时间轴的第二份字幕。"
        />
        <div className="import-actions">
          <label className="file-button">
            选择字幕文件
            <input
              type="file"
              accept=".vtt,.srt,text/vtt,text/plain"
              onChange={(e) => {
                void readFile(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </label>
          <button
            className="secondary"
            disabled={!candidate.trim() || evidence.busy || !!running}
            onClick={() => {
              setPage(1);
              void evidence.importTranscript(candidate);
            }}
          >
            比较字幕
          </button>
        </div>
      </details>
      {evidence.review ? (
        <>
          <div className="review-toolbar">
            <span>
              {evidence.review.rows.filter((r) => r.changed).length} 处分歧 · {unresolved} 处待确认
            </span>
            <label>
              <input
                type="checkbox"
                checked={onlyChanges}
                onChange={(e) => {
                  setOnlyChanges(e.target.checked);
                  setPage(1);
                }}
              />
              只看差异
            </label>
          </div>
          <div className="bulk-actions">
            <button disabled={evidence.busy} onClick={() => evidence.chooseAll('original')}>
              全部保留原字幕
            </button>
            <button disabled={evidence.busy} onClick={() => evidence.chooseAll('candidate')}>
              全部采用候选字幕
            </button>
          </div>
          {rows.length ? (
            rows
              .slice((page - 1) * 15, page * 15)
              .map((row) => (
                <ReviewRow
                  key={row.id}
                  row={row}
                  draft={evidence.drafts[row.id]}
                  disabled={evidence.busy}
                  choose={evidence.choose}
                  videoId={article?.source.videoId}
                  listen={evidence.audio ? playAt : undefined}
                />
              ))
          ) : (
            <p className="panel-empty">
              <Check size={19} />
              两份字幕在当前比较规则下没有文字差异。
            </p>
          )}
          {rows.length > 15 && (
            <div className="review-pagination">
              <button disabled={page <= 1} onClick={() => setPage(page - 1)}>
                上一页
              </button>
              <span>
                {page} / {Math.ceil(rows.length / 15)}
              </span>
              <button disabled={page * 15 >= rows.length} onClick={() => setPage(page + 1)}>
                下一页
              </button>
            </div>
          )}
          <footer className="review-footer">
            <span>校对版本 {evidence.review.version} · 原文章会保留</span>
            <div>
              <button
                className="secondary"
                disabled={!drafts || evidence.busy}
                onClick={() => evidence.save()}
              >
                保存校对{drafts ? `（${drafts}）` : ''}
              </button>
              <button
                className="primary"
                disabled={!!unresolved || !!drafts || evidence.busy || model.busy}
                onClick={generateReviewed}
              >
                按校对结果生成新文章
              </button>
            </div>
          </footer>
        </>
      ) : (
        <div className="panel-empty">
          <FileSearch size={24} />
          <p>导入第二份带时间轴的字幕，或等待辅助识别完成。</p>
        </div>
      )}
    </div>
  );
}
function ReviewRow({
  row,
  draft,
  disabled,
  choose,
  videoId,
  listen,
}: {
  row: ComparisonRow;
  draft?: { decision: ReviewDecision; text?: string };
  disabled: boolean;
  choose: (id: string, decision: ReviewDecision, text?: string) => void;
  videoId?: string;
  listen?: (offset: number) => void;
}) {
  const decision = draft?.decision ?? row.decision;
  const diff = useMemo(() => textDiff(row.original, row.candidate), [row.original, row.candidate]);
  return (
    <section className="review-row">
      <header>
        <span>
          {clock(row.offset)} – {clock(row.offset + row.duration)}
        </span>
        <span className={row.confirmed ? 'confirmed' : 'pending'}>
          {draft ? '尚未保存' : row.confirmed ? '已确认' : '待确认'}
        </span>
        {listen ? (
          <button className="text-button" onClick={() => listen(row.offset)}>
            回听
          </button>
        ) : (
          videoId && (
            <a
              href={`https://www.youtube.com/watch?v=${videoId}&t=${Math.floor(row.offset)}`}
              target="_blank"
              rel="noreferrer"
            >
              回听
              <ExternalLink size={12} />
            </a>
          )
        )}
      </header>
      <div className="difference-reasons">
        {row.reasons.map((reason) => (
          <span key={reason}>{reason}</span>
        ))}
      </div>
      <div className="comparison-columns">
        <div>
          <span>原字幕</span>
          <p>
            {row.original
              ? diff.original.map((part, i) =>
                  part.changed ? (
                    <mark key={i} className="diff-original">
                      {part.text}
                    </mark>
                  ) : (
                    part.text
                  ),
                )
              : '此处无字幕'}
          </p>
        </div>
        <div>
          <span>候选字幕</span>
          <p>
            {row.candidate
              ? diff.candidate.map((part, i) =>
                  part.changed ? (
                    <mark key={i} className="diff-candidate">
                      {part.text}
                    </mark>
                  ) : (
                    part.text
                  ),
                )
              : '此处无字幕'}
          </p>
        </div>
      </div>
      <div className="decision-buttons">
        <button
          disabled={disabled || !row.original}
          aria-pressed={decision === 'original'}
          onClick={() => choose(row.id, 'original')}
        >
          保留原字幕
        </button>
        <button
          disabled={disabled || !row.candidate}
          aria-pressed={decision === 'candidate'}
          onClick={() => choose(row.id, 'candidate')}
        >
          采用候选
        </button>
        <button
          disabled={disabled}
          aria-pressed={decision === 'edited'}
          onClick={() => choose(row.id, 'edited', row.edited ?? (row.original || row.candidate))}
        >
          手动修订
        </button>
      </div>
      {decision === 'edited' && (
        <label className="edit-caption">
          修订文字
          <textarea
            maxLength={2000}
            value={draft?.text ?? row.edited ?? row.original}
            onChange={(e) => choose(row.id, 'edited', e.target.value)}
          />
        </label>
      )}
    </section>
  );
}
