import type { Caption, ComparisonRow, ReviewDecision } from '../shared';
const normalize = (s: string) => s.toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
// Connected time intervals align one-to-many utterances without repeating an ASR sentence.
export function compareCaptions(base: Caption[], candidate: Caption[]): ComparisonRow[] {
  if (!base.some((c) => c.duration > 0) || !candidate.some((c) => c.duration > 0))
    throw new Error('逐段校对需要两份带时间轴的字幕，请导入 SRT 或 VTT。');
  const all = [...base, ...candidate],
    parent = all.map((_, i) => i);
  const root = (i: number): number => (parent[i] === i ? i : (parent[i] = root(parent[i])));
  let first = 0;
  base.forEach((b, i) => {
    while (
      first < candidate.length &&
      candidate[first].offset + candidate[first].duration <= b.offset
    )
      first++;
    for (let j = first; j < candidate.length && candidate[j].offset < b.offset + b.duration; j++) {
      const c = candidate[j],
        overlap =
          Math.min(c.offset + c.duration, b.offset + b.duration) - Math.max(c.offset, b.offset);
      if (overlap > Math.min(0.1, b.duration / 2, c.duration / 2))
        parent[root(base.length + j)] = root(i);
    }
  });
  const groups = new Map<number, { base: Caption[]; candidate: Caption[] }>();
  all.forEach((c, i) => {
    const id = root(i);
    const group = groups.get(id) ?? { base: [], candidate: [] };
    group[i < base.length ? 'base' : 'candidate'].push(c);
    groups.set(id, group);
  });
  return [...groups.values()]
    .map((group, i) => {
      const original = group.base.map((c) => c.text).join(' '),
        text = group.candidate.map((c) => c.text).join(' ');
      const changed = normalize(original) !== normalize(text),
        reasons: string[] = [];
      if (!text) reasons.push('候选缺少此片段');
      else if (!original) reasons.push('原字幕缺少此片段');
      else if (changed) {
        const numbers = (s: string) =>
          s
            .match(
              /\d+(?:[.,]\d+)*(?:%|％)?|[零一二三四五六七八九十百千万亿两]+(?=个|人|年|月|天|次|倍|家|元|美元|%)/g,
            )
            ?.join('|') ?? '';
        if (numbers(original) !== numbers(text)) reasons.push('数字有差异');
        const units = (s: string) =>
          s
            .toLowerCase()
            .match(
              /%|％|美元|人民币|亿元|万元|元|公里|厘米|毫米|千米|千克|公斤|毫克|分钟|小时|毫秒|摄氏度|华氏度|\b(?:percent|dollars?|cents?|million|billion|thousand|kilometers?|meters?|kilograms?|grams?|minutes?|hours?|seconds?|milliseconds?|kg|km|cm|mm|mg|ms)\b/g,
            )
            ?.join('|') ?? '';
        if (units(original) !== units(text)) reasons.push('单位或量级有差异');
        if (
          /\b(?:not|never|no|cannot|can't|don't|doesn't)\b|不|没有|未|不能/i.test(
            original + ' ' + text,
          )
        )
          reasons.push('含否定表达');
        reasons.push('文字有差异');
      }
      const parts = [...group.base, ...group.candidate],
        offset = Math.min(...parts.map((c) => c.offset)),
        end = Math.max(...parts.map((c) => c.offset + c.duration));
      return {
        id: `row-${i + 1}`,
        captionId: group.base[0]?.id ?? '',
        offset,
        duration: end - offset,
        original,
        candidate: text,
        changed,
        reasons,
        decision: original ? 'original' : 'candidate',
        confirmed: !changed,
      } satisfies ComparisonRow;
    })
    .sort((a, b) => a.offset - b.offset);
}
export function applyDecisions(
  rows: ComparisonRow[],
  changes: { id: string; decision: ReviewDecision; text?: string }[],
): ComparisonRow[] {
  const next = structuredClone(rows),
    seen = new Set<string>();
  for (const change of changes) {
    const row = next.find((r) => r.id === change.id);
    if (
      !row ||
      seen.has(change.id) ||
      !['original', 'candidate', 'edited'].includes(change.decision)
    )
      throw new Error('校对项无效，请刷新后重试。');
    seen.add(change.id);
    if (
      (change.decision === 'candidate' && !row.candidate) ||
      (change.decision === 'original' && !row.original)
    )
      throw new Error('选中的字幕为空。');
    if (
      change.decision === 'edited' &&
      (typeof change.text !== 'string' || !change.text.trim() || change.text.length > 2000)
    )
      throw new Error('修订文字不能为空，且最多 2,000 字。');
    row.decision = change.decision;
    row.edited = change.decision === 'edited' ? change.text!.trim() : undefined;
    row.confirmed = true;
  }
  return next;
}
export function reviewedCaptions(rows: ComparisonRow[]): Caption[] {
  if (rows.some((r) => r.changed && !r.confirmed)) throw new Error('请先确认所有存在分歧的片段。');
  return rows.map((r) => ({
    text:
      r.decision === 'edited' ? r.edited! : r.decision === 'candidate' ? r.candidate : r.original,
    offset: r.offset,
    duration: r.duration,
  }));
}
