import { readableLength } from '../../domain/requirements';
import { lengthDescription, withinLength, type LengthBudget } from '../../domain/length';
import { articleBlocks, applyBlockEdits } from '../../domain/article-edits';
import { generate, type AIEnv } from '../ai';
const system = `你是中文篇幅编辑，只依据给定的原稿，压缩或恢复原稿已有信息。不添加新事实、数字、人物、观点、问题或建议。保留关键结论、前提、否定和不确定性。
只改可编辑段落的正文。标题、讲者和引用由程序保留，不要在text中输出标题、讲者标记、链接、HTML或额外空段。按原有风格和受众写作；访谈仍保留真实问答，不能改成第三人称综述。
只输出JSON：{"edits":[{"id":"p3","text":"保留的短正文"},{"id":"p4","text":""}]}。每个输入段落id必须恰好出现一次，顺序无关。可以用空text删除允许省略的完整段落，但每章必须保留有依据的内容；若本组有hasEvidence为true的段落，至少保留其中一段；原来有多人问答的章节，仍需保留问答双方。requiredSpeakers列出的每位讲者必须至少保留一段发言。不要删除所有次要问句后留下无法理解的回答。每个text只能编辑同一id的原段落，不得合并其他id的事实。压缩时大部分次要段落可以为空，不必为每个id填入正文；完整保留每个id只指JSON条目完整。
按可读字符数控制长度：中文、英文字母、数字和标点各计1，标题与讲者也计入，空白、Markdown符号与引用链接不计。finalRange是本组正文的目标范围，最终全篇范围由程序验收。bodyWritingBudget是本轮校准后的正文写作预算（不含标题和讲者），请按它写，不要自行放宽；单章正文控制在chapterWritingBudget以内。总共最多保留maxRetainedParagraphs个有文字的段落，其他id仍输出空text。访谈通常每章只需保留最重要的1至2轮真实问答，不必覆盖每个原稿细节。补充信息时只能恢复originalText已有的论证，不重复凑字。`;
export async function fitLength(
  env: AIEnv,
  markdown: string,
  requirements: string,
  budget: LengthBudget,
  signal: AbortSignal,
): Promise<string> {
  signal.throwIfAborted();
  if (withinLength(readableLength(markdown), budget)) return markdown;
  const blocks = articleBlocks(markdown, /导语|引言|开场|摘要/.test(requirements));
  const editable = blocks.filter((b) => b.editable);
  if (!editable.length) throw new Error('初稿缺少可编辑的正文，已保留初稿。');
  let current = markdown;
  const chapterCount = Math.max(1, new Set(editable.map((b) => b.chapter)).size);
  const fixedLength = readableLength(
    blocks
      .filter((b) => !b.editable)
      .map((b) => b.text)
      .join(''),
  );
  let writingBudget = Math.max(40, budget.target - fixedLength);
  let currentTexts = new Map<string, string>();
  for (let attempt = 0; attempt < 3; attempt++) {
    const edits: { id: string; text: string }[] = [];
    for (const chapter of new Set(editable.map((b) => b.chapter))) {
      const group = editable.filter((b) => b.chapter === chapter);
      const chapterBudget = Math.max(20, Math.floor(writingBudget / chapterCount));
      let response = '';
      for await (const delta of generate(
        env,
        system,
        JSON.stringify({
          requiredSpeakers: [...new Set(group.map((b) => b.speaker).filter(Boolean))].slice(0, 2),
          scope: '只编辑本组段落，预算只针对本组正文；不要覆盖其他章节。',
          finalRange: `${Math.floor(chapterBudget * 0.9)}–${chapterBudget}字，仅本组正文`,
          bodyWritingBudget: chapterBudget,
          chapterWritingBudget: chapterBudget,
          maxRetainedParagraphs: Math.max(2, Math.floor(chapterBudget / 100)),
          validationFeedback: attempt
            ? `上一轮全篇实测${readableLength(current)}字，最终要求${lengthDescription(budget)}。本轮已按实测校准本组写作预算，请严格按bodyWritingBudget整理。`
            : undefined,
          blocks: group.map((b) => ({
            id: b.id,
            speaker: b.speaker,
            canOmit: b.canOmit,
            hasEvidence: b.refs.length > 0,
            text: currentTexts.get(b.id) ?? b.text,
            originalText: attempt > 0 && readableLength(current) < budget.min ? b.text : undefined,
          })),
          fixedText: blocks
            .filter((b) => !b.editable && (b.chapter === chapter || b.chapter === 0))
            .map((b) => b.text),
          finalInstruction: `最后要求：本组正文合计按约${chapterBudget}字的写作预算整理，不含标题、讲者和引用。当前本组正文约${group.reduce((sum, b) => sum + readableLength(currentTexts.get(b.id) ?? b.text), 0)}字。${readableLength(current) < budget.min ? '当前全篇偏短，必须从每个id的originalText恢复已有的论证、限定或例子，不能只复述当前短稿。' : '优先删除次要整段并压缩保留段落，不必覆盖原稿每个细节。'}每位requiredSpeakers至少保留一段；有hasEvidence段落时至少保留其中一段。只返回本组id和text的JSON。`,
        }),
        signal,
        true,
        10000,
      )) {
        signal.throwIfAborted();
        response += delta;
        if (response.length > 100000) throw new Error('篇幅编辑返回过长，初稿已保留。');
      }
      const data = JSON.parse(response.replace(/^```(?:json)?\s*|\s*```$/g, ''));
      if (
        !Array.isArray(data?.edits) ||
        data.edits.length !== group.length ||
        data.edits.some((edit: { id?: string }) => !group.some((b) => b.id === edit?.id))
      )
        throw new Error('篇幅编辑返回的段落不完整，初稿已保留。');
      edits.push(...data.edits);
    }
    current = applyBlockEdits(blocks, { edits });
    currentTexts = new Map(edits.map((edit) => [edit.id, edit.text.trim()]));
    if (withinLength(readableLength(current), budget)) return current;
    // 校准的是下一轮给模型的写作预算，最终验收始终使用用户要求的 budget。
    writingBudget = Math.max(
      40,
      Math.round((writingBudget * budget.target) / readableLength(current)),
    );
  }
  throw new Error(
    `篇幅调整后仍未达标：要求${lengthDescription(budget)}，实际 ${readableLength(current)} 字。已保留初稿，可继续整理或调整要求。`,
  );
}
