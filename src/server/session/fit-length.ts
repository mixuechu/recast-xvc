import { readableLength } from '../../domain/requirements';
import { lengthDescription, withinLength, type LengthBudget } from '../../domain/length';
import { splitArticle } from '../../shared';
import { citationIds, normalizeCitationLinks } from '../../domain/evidence';
import { generate, type AIEnv } from '../ai';
const system = `你是中文文章篇幅编辑。只编辑给定文章，不引入新事实、数字、人物、观点或提问，不使用外部知识。
保留主标题、全部二级标题及顺序；访谈保留原有讲者的真实问答形式，不得改为第三人称综述，单人讲述不能虚构提问。压缩时允许删除整轮次要问答、次要例子与重复内容，无需保留每一次发言。多人访谈可以每章只留一问一答，保留关键结论、前提和否定限制。篇幅优先于细节覆盖率。扩写只能恢复原稿已有信息，素材不足时不要凑字。
保留能支持改写后内容的原文引用，不得新编引用编号。每章必须保留至少一个原有的 [原文](#source-c0001) 格式链接；统计时不计入链接，但输出时必须保留链接，不能为了控字数删光引用。
字数按可读字符计算：每个中文汉字、每个英文字母、每个数字及标点都计1字，包含标题、说话人标签及标点，不含空白、Markdown符号和原文引用链接。
只输出完整Markdown，不要解释编辑过程；按writingBudget这个内部写作预算控制篇幅，它已为英文字符、标题和标签预留余量。不要因为它小于用户要求而自行扩写，最终范围由程序计数判定。`;
const speakers = (text: string) =>
  new Set([...text.matchAll(/^\*\*([^*\n]{1,40})[：:]\*\*/gm)].map((m) => m[1]));
// A lead repeats the article's overview; omit it only when whole chapters then fit.
function omitOptionalLead(markdown: string, requirements: string, budget: LengthBudget) {
  if (/导语|引言|开场|摘要/.test(requirements)) return markdown;
  const start = markdown.search(/^##\s+/m);
  const title = markdown.match(/^#\s+.+$/m)?.[0];
  if (start < 0 || !title) return markdown;
  if (speakers(markdown.slice(0, start)).size) return markdown;
  const shorter = `${title}\n\n${markdown.slice(start)}`;
  return withinLength(readableLength(shorter), budget) ? shorter : markdown;
}
export async function fitLength(
  env: AIEnv,
  markdown: string,
  requirements: string,
  budget: LengthBudget,
  signal: AbortSignal,
): Promise<string> {
  signal.throwIfAborted();
  if (withinLength(readableLength(markdown), budget)) return markdown;
  const withoutLead = omitOptionalLead(markdown, requirements, budget);
  if (withoutLead !== markdown) return withoutLead;
  if (!splitArticle(markdown).length) throw new Error('文章章节不完整，无法调整篇幅，已保留初稿。');
  let current = markdown;
  const dialogue = speakers(markdown).size >= 2;
  const known = new Set(citationIds(markdown));
  // A ceiling permits a shorter result; leave extra room for headings and speaker labels.
  let writingBudget = Math.round(budget.target * (budget.min === 0 ? 0.5 : 0.75));
  for (let attempt = 0; attempt < 3; attempt++) {
    const reducing = budget.max !== undefined && readableLength(current) > budget.max;
    let revised = '';
    for await (const delta of generate(
      env,
      system,
      JSON.stringify({
        article: current,
        originalArticle: attempt && readableLength(current) < budget.min ? markdown : undefined,
        currentLength: readableLength(current),
        chapterCount: splitArticle(markdown).length,
        preserveLead: /导语|引言|开场|摘要/.test(requirements),
        preserveOriginalStyleAndAudience: true,
        suggestedBodyLengthPerChapter: Math.max(
          20,
          Math.floor(
            (writingBudget -
              readableLength((markdown.match(/^#{1,2}\s+.+$/gm) ?? []).join('')) -
              60) /
              splitArticle(markdown).length,
          ),
        ),
        writingBudget,
        validationFeedback: attempt
          ? `上一轮实际为${readableLength(current)}字，仍未达标。需再${readableLength(current) > budget.target ? '删减' : '补充'}约${Math.abs(readableLength(current) - budget.target)}个可读字符。请按程序计数纠正，不得为了保留次要细节超过范围。`
          : undefined,
      }) +
        `\n本次编辑使用约 ${writingBudget} 字的内部写作预算。${reducing ? '压缩正文，允许舍弃次要问题和例子，不要追求覆盖所有原稿细节。' : '当前文字偏短，请恢复原稿已提供的论证和例子，适当展开；不要继续压缩，不得重复凑字或添加新事实。'}${attempt === 2 ? `这是最后一轮小幅调整：当前实测${readableLength(current)}字，只需${reducing ? `保留约${Math.round((budget.target / readableLength(current)) * 100)}%的文字` : `从原稿补回约${budget.target - readableLength(current)}字的已有细节`}，不要重新铺陈整篇论证。` : ''}${dialogue ? '保持原有讲者的真实问答。' : '保持原有讲述形式，不得虚构问答。'}主标题、二级标题和原文链接原样保留。直接输出调整后的 Markdown。`,
      signal,
    )) {
      signal.throwIfAborted();
      revised += delta;
      if (revised.length > 100000) throw new Error('篇幅调整结果过长，已保留初稿。');
    }
    revised = revised.replace(/^```(?:markdown|md)?\s*\n|\n```\s*$/g, '').trim();
    revised = normalizeCitationLinks(revised, known);
    const headings = (text: string) => text.match(/^#{1,2}\s+.+$/gm) ?? [];
    const originalHeadings = headings(markdown),
      editedHeadings = headings(revised);
    if (
      editedHeadings.length !== originalHeadings.length ||
      editedHeadings.some(
        (heading, i) => heading.match(/^#+/)?.[0] !== originalHeadings[i].match(/^#+/)?.[0],
      ) ||
      !splitArticle(revised).length
    )
      throw new Error('篇幅调整改变了章节结构，已保留初稿，请重试。');
    // Titles are immutable metadata; restore them by position, then verify chapter evidence below.
    let headingIndex = 0;
    revised = revised.replace(/^#{1,2}\s+.+$/gm, () => originalHeadings[headingIndex++]);
    revised = omitOptionalLead(revised, requirements, budget);
    const previous = speakers(markdown),
      next = speakers(revised);
    if (
      previous.size &&
      (next.size < Math.min(previous.size, 2) || [...next].some((name) => !previous.has(name)))
    )
      throw new Error('篇幅调整未保留原有讲者，已保留初稿，请重试。');
    if (citationIds(revised).some((id) => !known.has(id)))
      throw new Error('篇幅调整引入了新的引用编号，已保留初稿，请重试。');
    const previousChapters = splitArticle(markdown),
      nextChapters = splitArticle(revised);
    if (
      previousChapters.some((chapter, i) => {
        const refs = new Set(citationIds(chapter.markdown));
        return refs.size > 0 && !citationIds(nextChapters[i].markdown).some((id) => refs.has(id));
      })
    )
      throw new Error('篇幅调整丢失了章节原文依据，已保留初稿，请重试。');
    if (withinLength(readableLength(revised), budget)) return revised;
    writingBudget = Math.max(
      20,
      Math.round((writingBudget * budget.target) / readableLength(revised)),
    );
    current = revised;
  }
  throw new Error(
    `篇幅调整后仍未达标：要求${lengthDescription(budget)}，实际 ${readableLength(current)} 字。已保留初稿，请调整要求后重试。`,
  );
}
