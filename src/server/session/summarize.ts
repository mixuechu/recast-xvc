import type { Chapter, CitedSummary } from '../../shared';
import { validCitations, validateCitedSummary } from '../../domain/evidence';
import { generate, summarySystem, type AIEnv } from '../ai';
import { sourceText } from '../transcript';
import type { StoredArticle } from './types';
export async function summarize(
  env: AIEnv,
  stored: StoredArticle,
  chapter: Chapter,
): Promise<CitedSummary> {
  let text = '';
  for await (const delta of generate(
    env,
    summarySystem,
    JSON.stringify({
      transcript: sourceText(stored.source),
      article: stored.markdown,
      currentChapter: chapter,
      chapterEvidence: validCitations(chapter.markdown, stored.source.captions),
    }),
    AbortSignal.timeout(60000),
    true,
  ))
    text += delta;
  return validateCitedSummary(
    JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, '')),
    stored.source.captions,
  );
}
