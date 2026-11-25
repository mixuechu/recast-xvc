import { readableLength } from '../../domain/requirements';
import { lengthDescription, withinLength, type LengthBudget } from '../../domain/length';
import { splitArticle } from '../../shared';
import { citationIds } from '../../domain/evidence';
import { generate, type AIEnv } from '../ai';
const system = `你是中文文章篇幅编辑。只编辑给定文章，不引入新事实、数字、人物、观点或提问，不使用外部知识。
保留主标题、全部二级标题及顺序；访谈保留原有讲者的真实问答形式，不得改为第三人称综述。压缩时允许删除整轮次要问答、次要例子与重复内容，无需保留每一次发言。除非用户明确要求问答数量，每章优先只留一问一答，回答2–3句，保留关键结论、前提和否定限制。篇幅优先于细节覆盖率。扩写只能更清楚表达已有信息，素材不足时不要凑字。
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
  let writingBudget = Math.round(budget.target * 0.75);
  for (let attempt = 0; attempt < 2; attempt++) {
    let revised = '';
    for await (const delta of generate(
      env,
      system,
      JSON.stringify({
        article: current,
        originalArticle: attempt ? markdown : undefined,
        userRequirements: requirements,
        currentLength: readableLength(current),
        chapterCount: splitArticle(markdown).length,
        suggestedBodyLengthPerChapter: Math.max(
          20,
          Math.floor(
            (budget.target -
              readableLength((markdown.match(/^#{1,2}\s+.+$/gm) ?? []).join('')) -
              60) /
              splitArticle(markdown).length,
          ),
        ),
        allowedLength: lengthDescription(budget),
        finalRenderedLength: budget.target,
        writingBudget,
        validationFeedback: attempt
          ? `上一轮实际为${readableLength(current)}字，仍未达标。需再${readableLength(current) > budget.target ? '删减' : '补充'}约${Math.abs(readableLength(current) - budget.target)}个可读字符。请按程序计数纠正，不得为了保留次要细节超过范围。`
          : undefined,
      }),
      signal,
    )) {
      signal.throwIfAborted();
      revised += delta;
      if (revised.length > 100000) throw new Error('篇幅调整结果过长，已保留初稿。');
    }
    revised = revised.replace(/^```(?:markdown|md)?\s*\n|\n```\s*$/g, '').trim();
    revised = omitOptionalLead(revised, requirements, budget);
    const headings = (text: string) => text.match(/^#{1,2}\s+.+$/gm) ?? [];
    if (
      JSON.stringify(headings(revised)) !== JSON.stringify(headings(markdown)) ||
      !splitArticle(revised).length
    )
      throw new Error('篇幅调整改变了章节结构，已保留初稿，请重试。');
    const previous = speakers(markdown),
      next = speakers(revised);
    if (
      previous.size &&
      (next.size < Math.min(previous.size, 2) || [...next].some((name) => !previous.has(name)))
    )
      throw new Error('篇幅调整未保留原有讲者，已保留初稿，请重试。');
    const known = new Set(citationIds(markdown));
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
