import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import type { GenerationStage } from '../shared';
const steps: { stage: GenerationStage; label: string }[] = [
  { stage: 'source', label: '读取字幕' },
  { stage: 'writing', label: '生成初稿' },
  { stage: 'length', label: '整理篇幅' },
  { stage: 'evidence', label: '核对原文' },
];
export function GenerationProgress({ stage }: { stage: GenerationStage }) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const start = Date.now();
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(timer);
  }, []);
  const current = steps.findIndex((step) => step.stage === stage);
  return (
    <div className="generation-progress">
      <ol aria-label="整理进度">
        {steps.map((step, i) => (
          <li
            key={step.stage}
            className={i === current ? 'current' : i < current ? 'finished' : ''}
            aria-current={i === current ? 'step' : undefined}
            aria-label={`${step.label}，${i < current ? '已完成' : i === current ? '进行中' : '待开始'}`}
          >
            <span aria-hidden="true" className="step-number">
              {i < current ? <Check size={11} /> : i + 1}
            </span>
            {step.label}
          </li>
        ))}
      </ol>
      <span className="elapsed-time">
        本次已用时{' '}
        <time dateTime={`PT${seconds}S`}>
          {String(Math.floor(seconds / 60)).padStart(2, '0')}:
          {String(seconds % 60).padStart(2, '0')}
        </time>
      </span>
    </div>
  );
}
