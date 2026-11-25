export type DiffPart = { text: string; changed: boolean };
const tokens = (text: string) =>
  text.match(/\p{Script=Han}|[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*|\s+|[^\s]/gu) ?? [];
export function textDiff(
  original: string,
  candidate: string,
): { original: DiffPart[]; candidate: DiffPart[] } {
  const a = tokens(original),
    b = tokens(candidate),
    left: DiffPart[] = [],
    right: DiffPart[] = [];
  const add = (list: DiffPart[], text: string, changed: boolean) => {
    const previous = list.at(-1);
    if (previous?.changed === changed) previous.text += text;
    else list.push({ text, changed });
  };
  // Bound quadratic work for a very large alignment group.
  if (a.length * b.length > 160000) {
    let prefix = 0,
      suffix = 0;
    while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
    while (
      suffix < a.length - prefix &&
      suffix < b.length - prefix &&
      a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
    )
      suffix++;
    for (const [items, list] of [
      [a, left],
      [b, right],
    ] as const) {
      add(list, items.slice(0, prefix).join(''), false);
      add(list, items.slice(prefix, items.length - suffix).join(''), true);
      add(list, items.slice(items.length - suffix).join(''), false);
    }
    return { original: left, candidate: right };
  }
  const width = b.length + 1,
    table = new Uint16Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      table[i * width + j] =
        a[i] === b[j]
          ? table[(i + 1) * width + j + 1] + 1
          : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
  let i = 0,
    j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      add(left, a[i++], false);
      add(right, b[j++], false);
    } else if (
      i < a.length &&
      (j === b.length || table[(i + 1) * width + j] >= table[i * width + j + 1])
    )
      add(left, a[i++], true);
    else add(right, b[j++], true);
  }
  return { original: left, candidate: right };
}
