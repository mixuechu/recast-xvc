import { citationIds } from './evidence';
import { splitArticle } from '../shared';
export type ArticleBlock = {
  id: string;
  chapter: number;
  text: string;
  speaker: string;
  refs: string[];
  editable: boolean;
  canOmit: boolean;
};
const speakerPattern = /^\*\*([^*\n]{1,40})[：:]\*\*\s*/;
export function articleParagraphs(markdown: string): string[] {
  const isLabel = (text: string) =>
    speakerPattern.test(text) &&
    !text
      .replace(/\[[^\]]*\]\(#(?:source[-_=:])?c\d+\)/g, '')
      .replace(speakerPattern, '')
      .trim();
  const joined: string[] = [];
  for (const paragraph of markdown
    .replace(/^(#{1,3}\s+[^\n]+)$/gm, '\n\n$1\n\n')
    .trim()
    .split(/\n\s*\n/)) {
    const last = joined.length - 1;
    if (
      last >= 0 &&
      isLabel(joined[last]) &&
      !/^#{1,3}\s/.test(paragraph) &&
      !speakerPattern.test(paragraph)
    )
      joined[last] += ' ' + paragraph;
    else joined.push(paragraph);
  }
  return joined.filter((text) => text.trim() && !isLabel(text));
}
export function articleBlocks(markdown: string, preserveLead: boolean): ArticleBlock[] {
  let chapter = 0;
  return articleParagraphs(markdown).map((paragraph, i) => {
    const heading = /^#{1,3}\s/.test(paragraph);
    if (/^##\s/.test(paragraph)) chapter++;
    const refs = citationIds(paragraph);
    const speaker = paragraph.match(speakerPattern)?.[0].trim() ?? '';
    const text = paragraph
      .replace(/\[[^\]]*\]\(#(?:source[-_=:])?c\d+\)/g, '')
      .replace(speakerPattern, '')
      .trim();
    return {
      id: `p${i}`,
      chapter,
      text,
      speaker,
      refs,
      editable: !heading && !!text,
      canOmit: chapter > 0 || (!preserveLead && !speaker),
    };
  });
}
// 模型只提供正文，讲者和引用仍取自原段落；保留引用不等于证明改写后的语义。
export function renderBlocks(blocks: ArticleBlock[], texts: ReadonlyMap<string, string>): string {
  return blocks
    .map((block) => {
      const text = texts.get(block.id) ?? block.text;
      if (!text) return '';
      return `${block.speaker ? block.speaker + ' ' : ''}${text}${block.refs.map((id) => ` [原文](#source-${id})`).join('')}`;
    })
    .filter(Boolean)
    .join('\n\n');
}
const speakers = (text: string) =>
  new Set([...text.matchAll(/^\*\*([^*\n]{1,40})[：:]\*\*/gm)].map((m) => m[1]));
export function applyBlockEdits(blocks: ArticleBlock[], data: unknown): string {
  const edits = (data as { edits?: unknown } | null)?.edits;
  const editable = new Map(blocks.filter((b) => b.editable).map((b) => [b.id, b]));
  if (!Array.isArray(edits) || edits.length !== editable.size)
    throw new Error('篇幅编辑返回的段落不完整，初稿已保留。');
  const texts = new Map<string, string>();
  for (const edit of edits) {
    const block = editable.get(edit?.id);
    if (!block || texts.has(edit.id) || typeof edit.text !== 'string')
      throw new Error('篇幅编辑的段落编号无效，初稿已保留。');
    const text = edit.text.trim();
    if (
      (!text && !block.canOmit) ||
      /\n\s*\n|^#{1,6}\s|^\*\*[^*\n]+[：:]\*\*|\[[^\]]*\]\([^)]*\)|<\/?[a-z][^>]*>/im.test(text)
    )
      throw new Error('篇幅编辑改变了段落格式，初稿已保留。');
    texts.set(edit.id, text);
  }
  const original = renderBlocks(blocks, new Map()),
    result = renderBlocks(blocks, texts);
  const before = splitArticle(original),
    after = splitArticle(result);
  if (
    !before.length ||
    before.length !== after.length ||
    before.some((chapter, i) => {
      const required = new Set(citationIds(chapter.markdown));
      return (
        !after[i].markdown.trim() ||
        (required.size > 0 && !citationIds(after[i].markdown).some((id) => required.has(id))) ||
        speakers(after[i].markdown).size < Math.min(2, speakers(chapter.markdown).size)
      );
    })
  )
    throw new Error('篇幅编辑丢失了章节、讲者或依据，初稿已保留。');
  if (speakers(result).size < Math.min(2, speakers(original).size))
    throw new Error('篇幅编辑未保留讲者，初稿已保留。');
  return result;
}
