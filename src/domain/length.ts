export type LengthBudget = { min: number; max?: number; target: number };
const number =
  '(?:\\d+(?:[,，]\\d{3})*(?:\\.\\d+)?\\s*[kK千万]?|[零〇一二两三四五六七八九十百千万]+)';
function amount(raw: string): number {
  raw = raw.replace(/[,，\s]/g, '');
  const arabic = /^(\d+(?:\.\d+)?)([kK千万]?)$/.exec(raw);
  if (arabic)
    return Number(arabic[1]) * ({ k: 1000, K: 1000, 千: 1000, 万: 10000 }[arabic[2]] ?? 1);
  const digits: Record<string, number> = {
    零: 0,
    〇: 0,
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
  };
  const units: Record<string, number> = { 十: 10, 百: 100, 千: 1000, 万: 10000 };
  let total = 0,
    digit = 0;
  for (const char of raw) {
    if (char in digits) digit = digits[char];
    else if (char === '万') {
      total = (total + digit || 1) * 10000;
      digit = 0;
    } else {
      total += (digit || 1) * units[char];
      digit = 0;
    }
  }
  return total + digit;
}
// Parse explicit overall character budgets; local heading/paragraph lengths stay model instructions.
export function requestedLength(requirements: string): LengthBudget | undefined {
  const pattern = new RegExp(
    `(${number})(?:\\s*(?:字(?:符)?)?\\s*[-–—~～至到]\\s*(${number}))?\\s*(?:个)?(?:中文|汉)?字(?:符)?`,
    'g',
  );
  const budgets: LengthBudget[] = [];
  for (const match of requirements.matchAll(pattern)) {
    const before =
      requirements
        .slice(0, match.index)
        .split(/[，,。；;\n]/)
        .at(-1) ?? '';
    const global = [...before.matchAll(/全文|正文|文章|总字数|篇幅|字数/g)].at(-1)?.index ?? -1;
    const local =
      [...before.matchAll(/标题|每章|每节|每段|摘要|回答|问题|提问/g)].at(-1)?.index ?? -1;
    if (local > global) continue;
    const n = amount(match[1]),
      end = match.index! + match[0].length;
    const prefix = before.slice(-12),
      suffix = requirements.slice(end, end + 10).trimStart();
    // A source length is context, e.g. “从3000字压缩到1500字”.
    const tail = requirements.slice(end, end + 24).trimStart();
    if (
      /^(?:的(?:文章|原稿|初稿))?\s*(?:压缩|缩短|精简|扩写|扩充|改写|调整)/.test(tail) ||
      /^(?:原文|初稿|原稿)(?:约|大约|共|为|有|长|长度为|字数为|篇幅为)?\s*$/.test(before)
    )
      continue;
    let budget: LengthBudget;
    if (match[2]) {
      const max = amount(match[2]);
      budget = { min: n, max, target: Math.round((n + max) / 2) };
    } else if (
      /(?:不(?:要)?超过|不能超过|不得超过|不高于|不多于|最多|至多|上限(?:为)?|(?<!不)少于)\s*$/.test(
        prefix,
      ) ||
      /^(?:以内|以下|之内|内|封顶)/.test(suffix) ||
      (/控制在\s*$/.test(prefix) && !/^左右/.test(suffix))
    ) {
      const max = /(?<!不)少于\s*$/.test(prefix) ? n - 1 : n;
      budget = { min: 0, max, target: Math.floor((max * 9) / 10) };
    } else if (/(?:不少于|不低于|至少)\s*$/.test(prefix) || /^(?:以上|起)/.test(suffix)) {
      budget = { min: n, target: Math.ceil((n * 11) / 10) };
    } else if (/严格|精确|准确|恰好|正好/.test(prefix)) {
      budget = { min: n, max: n, target: n };
    } else budget = { min: Math.ceil((n * 9) / 10), max: Math.floor((n * 11) / 10), target: n };
    if (
      !Number.isInteger(n) ||
      n < 80 ||
      n > 10000 ||
      (budget.max !== undefined && (budget.max < budget.min || budget.max > 10000))
    )
      throw new Error('总篇幅请设置在 80–10,000 字之间，且范围下限不得大于上限。');
    budgets.push(budget);
  }
  if (!budgets.length) return;
  const min = Math.max(...budgets.map((b) => b.min));
  const upper = budgets.flatMap((b) => (b.max === undefined ? [] : [b.max]));
  const max = upper.length ? Math.min(...upper) : undefined;
  if (max !== undefined && min > max) throw new Error('总字数要求相互冲突，请调整篇幅范围。');
  return { min, max, target: Math.max(min, Math.min(max ?? Infinity, budgets[0].target)) };
}
export function withinLength(length: number, budget: LengthBudget) {
  return length >= budget.min && (budget.max === undefined || length <= budget.max);
}
export function lengthDescription(budget: LengthBudget) {
  return budget.min === budget.max
    ? `${budget.min} 字`
    : budget.min === 0
      ? `不超过 ${budget.max} 字`
      : budget.max === undefined
        ? `至少 ${budget.min} 字`
        : `${budget.min}–${budget.max} 字`;
}
