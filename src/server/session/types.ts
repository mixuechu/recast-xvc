import type { Article, Source, CitedSummary } from '../../shared';
export type StoredArticle = Article & {
  source: Source;
  summaries: Record<string, CitedSummary>;
  schemaVersion: 2;
};
export type GenerateInput = {
  mode: string;
  url?: string;
  transcript?: string;
  requirements: string;
};
